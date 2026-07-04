import { createHmac, timingSafeEqual } from "node:crypto";

// Compact HMAC-signed tokens for cookies: base64url(json) + "." + base64url(hmac-sha256).
// Payloads carry an `exp` (unix seconds); opening distinguishes expired from tampered.

export interface Expiring {
  exp: number;
}

export type OpenResult<T extends Expiring> =
  | { ok: true; payload: T }
  | { ok: false; reason: "invalid" | "expired" };

function sign(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function seal(payload: Expiring, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret).toString("base64url")}`;
}

export function open<T extends Expiring>(token: string | undefined, secret: string): OpenResult<T> {
  if (!token) return { ok: false, reason: "invalid" };
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const body = token.slice(0, dot);
  const mac = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = sign(body, secret);
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    return { ok: false, reason: "invalid" };
  }
  let payload: T;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}
