import { HandledError } from "@dockos/contract";
import type { AuthSessionResult, AuthSignoutResult, Operator } from "@dockos/contract";
import type { OidcAuthService } from "./oidc-auth.ts";

// Three ways to know the operator, selected by DOCKOS_AUTH:
//   forward — trust Authelia's forward-auth headers (Caddy injects them after verifying)
//   oidc    — the server is its own OIDC relying party; identity lives in the session cookie
//             minted by /auth/callback (see oidc-auth.ts)
//   dev     — fabricate a local operator (local dev without an IdP)
// Unset: oidc when DOCKOS_OIDC_* is configured, else forward in production, else dev.
// Modes are exclusive on purpose: honoring Remote-User headers while running in oidc mode
// would let a directly-reached client spoof identity.

export type AuthMode = "forward" | "oidc" | "dev";

export function resolveAuthMode(env: NodeJS.ProcessEnv, oidcConfigured: boolean): AuthMode {
  const raw = env.DOCKOS_AUTH;
  if (raw === "forward" || raw === "oidc" || raw === "dev") return raw;
  if (oidcConfigured) return "oidc";
  return env.NODE_ENV === "production" ? "forward" : "dev";
}

export type HeaderReader = (name: string) => string | undefined;

const LOGIN_META = { loginUrl: "/auth/login" };

export class AuthService {
  private readonly mode: AuthMode;
  private readonly oidc: OidcAuthService | null;

  constructor(mode: AuthMode, oidc: OidcAuthService | null) {
    this.mode = mode;
    this.oidc = oidc;
  }

  session(header: HeaderReader): AuthSessionResult {
    if (this.mode === "dev") return { operator: devOperator() };
    if (this.mode === "oidc") return { operator: this.oidcOperator(header) };
    return { operator: forwardOperator(header) };
  }

  // Where the browser should go to sign out. Only oidc mode owns a docking session cookie, so only
  // it has something to clear: the app's own /auth/logout (a GET — the RPC response can't set
  // cookies) wipes the session cookie and redirects on to the provider's end-session endpoint.
  // forward/dev mode carry no docking session, so there is nothing for the app to do (null) — the
  // operator signs out at the identity provider / proxy portal instead.
  signout(): AuthSignoutResult {
    if (this.mode === "oidc" && this.oidc) return { redirectUrl: "/auth/logout" };
    return { redirectUrl: null };
  }

  private oidcOperator(header: HeaderReader): Operator {
    if (!this.oidc) {
      throw new HandledError("auth.failed", "OIDC mode is enabled but not configured", {
        hint: "set DOCKOS_OIDC_ISSUER, DOCKOS_OIDC_CLIENT_ID and DOCKOS_OIDC_CLIENT_SECRET",
      });
    }
    const session = this.oidc.sessionFrom(header("cookie"));
    if (!session.ok) {
      if (session.reason === "expired") {
        throw new HandledError("auth.expired", "the sign-in session has expired", {
          hint: "sign in again at /auth/login",
          meta: LOGIN_META,
        });
      }
      throw new HandledError("auth.missing", "no operator identity on this request", {
        hint: "sign in at /auth/login",
        meta: LOGIN_META,
      });
    }
    const { u, e, n, g } = session.payload;
    return { username: u, email: e, name: n, groups: g };
  }
}

function forwardOperator(header: HeaderReader): Operator {
  const username = header("remote-user")?.trim();
  if (!username) {
    throw new HandledError("auth.missing", "no operator identity on this request", {
      hint: "sign in through the Authelia portal, then reload",
    });
  }
  const groups = (header("remote-groups") ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
  return {
    username,
    email: header("remote-email")?.trim() || null,
    name: header("remote-name")?.trim() || null,
    groups,
  };
}

function devOperator(): Operator {
  return {
    username: "operator",
    email: "operator@localhost",
    name: "Local Operator",
    groups: ["dev"],
  };
}
