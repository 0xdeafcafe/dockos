import { createHash, randomBytes } from "node:crypto";
import { HandledError } from "@dockos/contract";
import type { OidcClient, OidcConfig } from "../adapters/oidc.ts";
import { expireCookie, parseCookies, serializeCookie } from "../util/cookies.ts";
import { open, seal } from "../util/sealed.ts";
import type { OpenResult } from "../util/sealed.ts";
import type { Logger } from "../util/logger.ts";

// Browser-facing half of OIDC sign-in: /auth/login builds the provider redirect (state + nonce
// + PKCE verifier sealed into a short-lived txn cookie), /auth/callback exchanges the code,
// verifies the ID token, and seals the operator into an HMAC-signed session cookie. auth.session
// then reads that cookie — no server-side session store.

export const SESSION_COOKIE = "dockos_session";
const TXN_COOKIE = "dockos_oidc_txn";
const TXN_TTL_S = 600;
const SESSION_MAX_S = 12 * 60 * 60;

export interface SessionPayload {
  u: string;
  e: string | null;
  n: string | null;
  g: string[];
  exp: number;
}

interface TxnPayload {
  s: string;
  n: string;
  v: string;
  r: string;
  exp: number;
}

function b64url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

export class OidcAuthService {
  private readonly client: OidcClient;
  private readonly config: OidcConfig;
  private readonly secret: string;
  private readonly log: Logger;

  constructor(client: OidcClient, config: OidcConfig, secret: string, log: Logger) {
    this.client = client;
    this.config = config;
    this.secret = secret;
    this.log = log;
  }

  async beginLogin(origin: string): Promise<{ redirectUrl: string; cookies: string[] }> {
    const redirectUri = this.config.redirectUri ?? `${origin}/auth/callback`;
    const state = b64url(16);
    const nonce = b64url(16);
    const verifier = b64url(32);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirectUrl = await this.client.authorizationUrl({
      redirectUri,
      state,
      nonce,
      codeChallenge: challenge,
    });
    const txn: TxnPayload = {
      s: state,
      n: nonce,
      v: verifier,
      r: redirectUri,
      exp: Math.floor(Date.now() / 1000) + TXN_TTL_S,
    };
    const cookie = serializeCookie(TXN_COOKIE, seal(txn, this.secret), {
      maxAge: TXN_TTL_S,
      secure: redirectUri.startsWith("https://"),
    });
    this.log.info({ redirectUri }, "oidc login started");
    return { redirectUrl, cookies: [cookie] };
  }

  async completeLogin(
    requestUrl: URL,
    cookieHeader: string | undefined,
  ): Promise<{ cookies: string[] }> {
    const txnToken = parseCookies(cookieHeader).get(TXN_COOKIE);
    const txn = open<TxnPayload>(txnToken, this.secret);
    if (!txn.ok) {
      throw new HandledError("auth.failed", "login attempt is missing or expired", {
        hint: "start again at /auth/login",
      });
    }
    const err = requestUrl.searchParams.get("error");
    if (err) {
      const detail = requestUrl.searchParams.get("error_description") ?? err;
      throw new HandledError("auth.failed", `provider refused the sign-in: ${detail}`);
    }
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");
    if (!code || state !== txn.payload.s) {
      throw new HandledError("auth.failed", "callback state mismatch");
    }
    const idToken = await this.client.exchangeCode(code, txn.payload.r, txn.payload.v);
    const claims = await this.client.verifyIdToken(idToken, txn.payload.n);
    const now = Math.floor(Date.now() / 1000);
    const session: SessionPayload = {
      u: claims.preferred_username ?? claims.sub,
      e: claims.email ?? null,
      n: claims.name ?? null,
      g: claims.groups ?? [],
      exp: Math.min(claims.exp, now + SESSION_MAX_S),
    };
    const secure = txn.payload.r.startsWith("https://");
    this.log.info({ operator: session.u }, "oidc login completed");
    return {
      cookies: [
        serializeCookie(SESSION_COOKIE, seal(session, this.secret), {
          maxAge: session.exp - now,
          secure,
        }),
        expireCookie(TXN_COOKIE, { secure }),
      ],
    };
  }

  logoutCookies(): string[] {
    return [expireCookie(SESSION_COOKIE), expireCookie(TXN_COOKIE)];
  }

  // Server-side sign-out: the cookies that clear the docking session, plus the provider's end-session
  // URL to bounce the browser through (so Authelia's SSO session drops too, not just ours). We do NOT
  // pass a post_logout_redirect_uri — Authelia only honors ones registered on the client, and the app
  // clears its own session before the hop anyway. The end-session lookup is best-effort: a provider
  // that is momentarily unreachable must never wedge sign-out, so we still return the clearing cookies
  // and let the caller land on "/".
  async signout(): Promise<{ cookies: string[]; redirectUrl: string | null }> {
    let redirectUrl: string | null = null;
    try {
      redirectUrl = await this.client.endSessionUrl({});
    } catch (err) {
      this.log.warn({ err }, "oidc end-session lookup failed; clearing local session only");
    }
    return { cookies: this.logoutCookies(), redirectUrl };
  }

  sessionFrom(cookieHeader: string | undefined): OpenResult<SessionPayload> {
    return open<SessionPayload>(parseCookies(cookieHeader).get(SESSION_COOKIE), this.secret);
  }
}
