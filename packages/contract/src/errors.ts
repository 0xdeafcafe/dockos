import { z } from "zod";

// The wire shape a HandledError serializes to. Web reconstructs + renders from this; it never sees
// server internals — unhandled errors arrive as kind "internal" with a generic message.
export const SerializedError = z.object({
  kind: z.string(),
  message: z.string(),
  meta: z.record(z.unknown()).default({}),
  hint: z.string().optional(),
  httpStatus: z.number().int().default(500),
});
export type SerializedError = z.infer<typeof SerializedError>;

// Every kind the server intentionally raises. Machine-readable: the web branches on these
// (e.g. the boot sequence goes red on "auth.missing"/"auth.expired").
export const ERROR_KINDS = {
  // The request body failed zod validation for the method's params schema.
  "validation.failed": 400,
  // No identity on the request (no forward-auth headers and no OIDC session cookie).
  "auth.missing": 401,
  // The session existed but is no longer valid — sign in again.
  "auth.expired": 401,
  // An OIDC sign-in attempt failed (bad callback, token exchange or ID-token verification).
  "auth.failed": 401,
  // The referenced container / stack / network does not exist.
  "unit.not_found": 404,
  // POSTed to /rpc/<method> for a method that is not in the contract.
  "rpc.unknown_method": 404,
  // The unit exists but is in a state that rejects the action (e.g. kill on a stopped unit).
  "unit.conflict": 409,
  // The action is disabled by server config (read-only mode or a switched-off capability).
  forbidden: 403,
  // Could not reach the Docker engine (socket proxy down, bad DOCKER_HOST).
  "docker.unreachable": 502,
  // The Docker engine answered with an error we did not anticipate.
  "docker.error": 502,
  // Could not reach the Prometheus server (DOCKOS_PROMETHEUS_URL down, wrong, or unset).
  "prometheus.unreachable": 502,
  // Prometheus was reached but answered with an error (bad PromQL, non-success status).
  "prometheus.error": 502,
  // Anything unhandled — stack traces are logged server-side, never sent to the client.
  internal: 500,
} as const;
export type ErrorKind = keyof typeof ERROR_KINDS;

export interface HandledErrorOptions {
  meta?: Record<string, unknown>;
  hint?: string;
  httpStatus?: number;
  cause?: unknown;
}

// The one error type the RPC kernel serializes to clients. Everything else is masked.
export class HandledError extends Error {
  readonly kind: ErrorKind;
  readonly meta: Record<string, unknown>;
  readonly hint: string | undefined;
  readonly httpStatus: number;

  constructor(kind: ErrorKind, message: string, options: HandledErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "HandledError";
    this.kind = kind;
    this.meta = options.meta ?? {};
    this.hint = options.hint;
    this.httpStatus = options.httpStatus ?? ERROR_KINDS[kind];
  }

  serialize(): SerializedError {
    return {
      kind: this.kind,
      message: this.message,
      meta: this.meta,
      httpStatus: this.httpStatus,
      ...(this.hint === undefined ? {} : { hint: this.hint }),
    };
  }
}
