import { HandledError, isMethodName, rpcMethods } from "@dockos/contract";
import type { MethodName, MethodParams, MethodResult, SerializedError } from "@dockos/contract";
import type { Logger } from "../util/logger.ts";
import type { MetricsService } from "../services/metrics.ts";

// The RPC kernel: validates params against the contract, runs the handler, validates the
// result, and turns every failure into the { ok: false, error } envelope. HandledErrors pass
// through serialized; anything else is logged server-side and masked as kind "internal".
// Every dispatch is logged (pino) and observed (prometheus).

export interface RpcContext {
  header: (name: string) => string | undefined;
}

export type RpcHandler<M extends MethodName> = (
  params: MethodParams<M>,
  ctx: RpcContext,
) => MethodResult<M> | Promise<MethodResult<M>>;

type AnyHandler = (params: unknown, ctx: RpcContext) => unknown;

export interface RpcResponse {
  status: number;
  body: { ok: true; data: unknown } | { ok: false; error: SerializedError };
}

export function errorResponse(error: HandledError): RpcResponse {
  const serialized = error.serialize();
  return { status: serialized.httpStatus, body: { ok: false, error: serialized } };
}

export class RpcKernel {
  private readonly handlers = new Map<MethodName, AnyHandler>();
  private readonly log: Logger;
  private readonly metrics: MetricsService | null;

  constructor(log: Logger, metrics: MetricsService | null) {
    this.log = log;
    this.metrics = metrics;
  }

  register<M extends MethodName>(method: M, handler: RpcHandler<M>): void {
    this.handlers.set(method, handler as AnyHandler);
  }

  async dispatch(method: string, rawParams: unknown, ctx: RpcContext): Promise<RpcResponse> {
    const started = performance.now();
    const response = await this.dispatchInner(method, rawParams, ctx);
    const ms = performance.now() - started;
    const outcome = response.body.ok ? "ok" : response.body.error.kind;
    // rpc.unknown_method would let arbitrary paths mint unbounded metric label values
    const label = isMethodName(method) ? method : "(unknown)";
    this.metrics?.observeRpc(label, outcome, ms / 1000);
    this.log[response.body.ok ? "info" : "warn"](
      { method: label, outcome, ms: Math.round(ms * 10) / 10, status: response.status },
      "rpc",
    );
    return response;
  }

  private async dispatchInner(
    method: string,
    rawParams: unknown,
    ctx: RpcContext,
  ): Promise<RpcResponse> {
    try {
      return await this.run(method, rawParams, ctx);
    } catch (err) {
      if (err instanceof HandledError) return errorResponse(err);
      this.log.error({ method, err }, "unhandled rpc error");
      return errorResponse(new HandledError("internal", "internal error", { meta: { method } }));
    }
  }

  private async run(method: string, rawParams: unknown, ctx: RpcContext): Promise<RpcResponse> {
    if (!isMethodName(method)) {
      throw new HandledError("rpc.unknown_method", `no such method: ${method}`, {
        hint: "method names are <domain>.<name>, e.g. containers.list",
      });
    }
    const handler = this.handlers.get(method);
    if (!handler) {
      throw new HandledError("internal", `method not wired: ${method}`, { meta: { method } });
    }
    const schema = rpcMethods[method];
    const parsed = schema.params.safeParse(rawParams ?? {});
    if (!parsed.success) {
      throw new HandledError("validation.failed", `invalid params for ${method}`, {
        meta: { issues: parsed.error.issues },
        hint: "see meta.issues for the failing fields",
      });
    }
    const result = await handler(parsed.data, ctx);
    return { status: 200, body: { ok: true, data: schema.result.parse(result) } };
  }
}
