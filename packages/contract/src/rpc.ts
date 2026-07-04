import { z } from "zod";
import { SerializedError } from "./errors.ts";

// ── The DOCK/OS RPC protocol ──────────────────────────────────────────────────────────────────
//
// Transport: HTTP, all-POST, JSON both ways. One route per method:
//
//   POST /rpc/<domain>.<name>          e.g. POST /rpc/containers.restart
//   Content-Type: application/json
//   body = the method's params object (an empty/omitted body means `{}`)
//
// Every method's params AND result are zod schemas in this package (see methods.ts for the full
// typed map) — server validates both directions, web imports the same types via z.infer.
//
// Responses are always one of the two envelopes below:
//
//   200            → { ok: true,  data: <result> }
//   4xx/5xx        → { ok: false, error: { kind, message, meta, hint?, httpStatus } }
//
// The HTTP status mirrors error.httpStatus (see ERROR_KINDS in errors.ts for the kind → status
// map). Unhandled server errors never leak stacks: they arrive as kind "internal".
// ──────────────────────────────────────────────────────────────────────────────────────────────

export const RpcFailure = z.object({
  ok: z.literal(false),
  error: SerializedError,
});
export type RpcFailure = z.infer<typeof RpcFailure>;
