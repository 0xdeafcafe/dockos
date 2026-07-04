// The real auth gate. Boot queries `auth.session`; a kind "auth.missing"/"auth.expired" failure
// stamps the scan ✖ REVOKED and slams the DENIED scene, anything else proceeds. Under mock
// (VITE_USE_MOCK on) the session always resolves, so the deck boots straight through.
import { rpc, RpcError } from "../../rpc/client.ts";

// Manual QA override so the DENIED cinematic stays reachable without a real 401 (dev only).
const DENY_KEY = "dockos.deny";

export function isDeniedOverride(): boolean {
  return sessionStorage.getItem(DENY_KEY) === "1";
}

export function simulateDenied(): void {
  sessionStorage.setItem(DENY_KEY, "1");
  location.reload();
}

export function clearDenyOverride(): void {
  sessionStorage.removeItem(DENY_KEY);
}

export type AuthOutcome = "granted" | "denied";

// Fail closed: only a confirmed session grants entry. Auth-kind failures are the designed
// DENIED path; any other error (engine/transport) also holds the wall rather than leaking in.
export async function checkSession(): Promise<AuthOutcome> {
  if (isDeniedOverride()) return "denied";
  try {
    await rpc("auth.session", {});
    return "granted";
  } catch (err) {
    if (err instanceof RpcError && (err.kind === "auth.missing" || err.kind === "auth.expired")) {
      return "denied";
    }
    return "denied";
  }
}

// SIGN OUT: clear the app server's session, then bounce to the SSO end-session (if the
// server hands one back) or reload — the next boot check finds no session → DENIED scene.
// Uses a raw POST rather than the typed rpc() so it doesn't depend on `auth.signout` being in
// the contract yet (the backend adds the method during the OIDC deploy); it degrades to a
// reload if the endpoint isn't there.
export async function signOut(): Promise<void> {
  const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
  clearDenyOverride();
  try {
    const res = await fetch(`${base}/rpc/auth.signout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    const env: unknown = await res.json().catch(() => null);
    const url =
      env && typeof env === "object" && "data" in env
        ? (env as { data?: { logoutUrl?: unknown } }).data?.logoutUrl
        : undefined;
    if (typeof url === "string" && url.length > 0) {
      window.location.assign(url.startsWith("http") ? url : `${base}${url}`);
      return;
    }
  } catch {
    // fall through to a reload — the server should have cleared the cookie regardless
  }
  window.location.reload();
}

// "VERIFY VIA SSO": send the browser to wherever the backend signs operators in. In OIDC
// mode config.get hands us a loginUrl (/auth/login); in forward-auth / dev mode there is none,
// so a reload re-hits the proxy, which triggers the SSO redirect (and re-runs the boot check).
export async function beginLogin(): Promise<void> {
  clearDenyOverride();
  try {
    const cfg = await rpc("config.get", {});
    if (cfg.auth.loginUrl !== null) {
      const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
      window.location.assign(`${base}${cfg.auth.loginUrl}`);
      return;
    }
  } catch {
    // fall through to a reload — the proxy will drive the sign-in
  }
  window.location.reload();
}
