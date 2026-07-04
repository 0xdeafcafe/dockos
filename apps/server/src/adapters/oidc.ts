import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { JsonWebKey } from "node:crypto";
import { HandledError } from "@dockos/contract";

// OIDC relying party against any spec-compliant provider (Authelia in the stack): discovery,
// authorization-code + PKCE, ID-token verification via the provider's JWKS. Plain fetch +
// node:crypto — no client library. RS256/ES256 signatures are supported.

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  // fixed redirect URI; when null it is derived per-request from the origin + /auth/callback
  redirectUri: string | null;
  scopes: string;
}

export function loadOidcConfig(env: NodeJS.ProcessEnv): OidcConfig | null {
  const issuer = env.DOCKOS_OIDC_ISSUER?.trim();
  const clientId = env.DOCKOS_OIDC_CLIENT_ID?.trim();
  const clientSecret = env.DOCKOS_OIDC_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) return null;
  return {
    issuer: issuer.replace(/\/$/u, ""),
    clientId,
    clientSecret,
    redirectUri: env.DOCKOS_OIDC_REDIRECT_URI?.trim() || null,
    scopes: env.DOCKOS_OIDC_SCOPES?.trim() || "openid profile email groups",
  };
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

interface Jwk {
  kty: string;
  kid?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

export interface IdClaims {
  sub: string;
  exp: number;
  preferred_username?: string;
  name?: string;
  email?: string;
  groups?: string[];
  nonce?: string;
}

interface RawClaims extends IdClaims {
  iss?: string;
  aud?: string | string[];
}

const JWKS_TTL_MS = 10 * 60 * 1000;

function b64urlJson<T>(part: string, what: string): T {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
  } catch {
    throw new HandledError("auth.failed", `malformed ${what} in ID token`);
  }
}

async function fetchJson<T>(url: string, init: RequestInit, what: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    throw new HandledError("auth.failed", `cannot reach the OIDC provider (${what})`, {
      meta: { url },
      cause: err,
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HandledError("auth.failed", `OIDC ${what} failed with ${res.status}`, {
      meta: { url, status: res.status, body: body.slice(0, 300) },
    });
  }
  return (await res.json()) as T;
}

export class OidcClient {
  private readonly config: OidcConfig;
  private discovery: Discovery | null = null;
  private jwks: { keys: Jwk[]; at: number } | null = null;

  constructor(config: OidcConfig) {
    this.config = config;
  }

  async authorizationUrl(input: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string> {
    const disco = await this.discover();
    const url = new URL(disco.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: input.redirectUri,
      scope: this.config.scopes,
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  // RP-initiated logout (OIDC front-channel): the provider's end-session endpoint, tagged with our
  // client id and where to return the browser afterwards. null when the provider advertises none in
  // discovery — the caller then just clears the local session and lands back on the app.
  async endSessionUrl(input: { postLogoutRedirectUri?: string }): Promise<string | null> {
    const disco = await this.discover();
    if (!disco.end_session_endpoint) return null;
    const url = new URL(disco.end_session_endpoint);
    url.searchParams.set("client_id", this.config.clientId);
    if (input.postLogoutRedirectUri) {
      url.searchParams.set("post_logout_redirect_uri", input.postLogoutRedirectUri);
    }
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<string> {
    const disco = await this.discover();
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64",
    );
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: this.config.clientId,
    });
    const tokens = await fetchJson<{ id_token?: string }>(
      disco.token_endpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
      "token exchange",
    );
    if (!tokens.id_token) throw new HandledError("auth.failed", "token response had no id_token");
    return tokens.id_token;
  }

  async verifyIdToken(idToken: string, nonce: string): Promise<IdClaims> {
    const [h, p, s] = idToken.split(".");
    if (!h || !p || !s) throw new HandledError("auth.failed", "malformed ID token");
    const header = b64urlJson<{ alg?: string; kid?: string }>(h, "header");
    const claims = b64urlJson<RawClaims>(p, "claims");
    await this.verifySignature(header, `${h}.${p}`, Buffer.from(s, "base64url"));
    this.verifyClaims(claims, nonce);
    return claims;
  }

  private verifyClaims(claims: RawClaims, nonce: string): void {
    const disco = this.discovery;
    if (claims.iss !== (disco?.issuer ?? this.config.issuer)) {
      throw new HandledError("auth.failed", "ID token issuer mismatch");
    }
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.config.clientId)) {
      throw new HandledError("auth.failed", "ID token audience mismatch");
    }
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) {
      throw new HandledError("auth.expired", "ID token already expired");
    }
    if (claims.nonce !== nonce) {
      throw new HandledError("auth.failed", "ID token nonce mismatch");
    }
  }

  private async verifySignature(
    header: { alg?: string; kid?: string },
    data: string,
    signature: Buffer,
  ): Promise<void> {
    const keys = await this.signingKeys();
    const jwk =
      keys.find((k) => header.kid !== undefined && k.kid === header.kid) ??
      keys.find((k) => (header.alg === "ES256" ? k.kty === "EC" : k.kty === "RSA"));
    if (!jwk) throw new HandledError("auth.failed", "no matching JWKS key for ID token");
    const key = createPublicKey({ key: jwk as unknown as JsonWebKey, format: "jwk" });
    const payload = Buffer.from(data);
    let valid = false;
    if (header.alg === "RS256") {
      valid = cryptoVerify("sha256", payload, key, signature);
    } else if (header.alg === "ES256") {
      valid = cryptoVerify("sha256", payload, { key, dsaEncoding: "ieee-p1363" }, signature);
    } else {
      throw new HandledError("auth.failed", `unsupported ID token alg: ${header.alg ?? "none"}`);
    }
    if (!valid) throw new HandledError("auth.failed", "ID token signature verification failed");
  }

  private async discover(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    const url = `${this.config.issuer}/.well-known/openid-configuration`;
    this.discovery = await fetchJson<Discovery>(url, {}, "discovery");
    return this.discovery;
  }

  private async signingKeys(): Promise<Jwk[]> {
    if (this.jwks && Date.now() - this.jwks.at < JWKS_TTL_MS) return this.jwks.keys;
    const disco = await this.discover();
    const res = await fetchJson<{ keys: Jwk[] }>(disco.jwks_uri, {}, "JWKS fetch");
    this.jwks = { keys: res.keys, at: Date.now() };
    return res.keys;
  }
}
