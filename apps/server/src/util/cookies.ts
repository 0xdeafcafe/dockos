// Tiny cookie helpers — enough for the OIDC session + transaction cookies, no dependency.

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out.set(name, decodeURIComponent(value));
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  path?: string;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const maxAge =
    opts.maxAge === undefined ? null : `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`;
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/"}`,
    maxAge,
    "HttpOnly",
    `SameSite=${opts.sameSite ?? "Lax"}`,
    opts.secure ? "Secure" : null,
  ];
  return parts.filter((p) => p !== null).join("; ");
}

export function expireCookie(name: string, opts: CookieOptions = {}): string {
  return serializeCookie(name, "", { ...opts, maxAge: 0 });
}
