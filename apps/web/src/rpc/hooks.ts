import { useCallback, useEffect, useRef, useState } from "react";
import type { MethodInput, MethodName, MethodResult } from "@dockos/contract";
import { useError } from "../errors/ErrorProvider.tsx";
import type { ClientError } from "../errors/types.ts";
import { rpc, RpcError } from "./client.ts";

// React 19 data hooks over the RPC client. Reads poll on an interval with clean teardown (SSE is
// deliberately out of scope — the backend is poll-based). Mutations run through `useRpcAction`,
// which surfaces failures to the ErrorProvider dialog.

function toRpcError(err: unknown): RpcError {
  if (err instanceof RpcError) return err;
  return new RpcError({
    kind: "internal",
    message: err instanceof Error ? err.message : String(err),
    meta: {},
    httpStatus: 0,
  });
}

function toClientError(err: RpcError): ClientError {
  const client: ClientError = { kind: err.kind, message: err.message, meta: err.meta };
  // exactOptionalPropertyTypes: only attach hint when present.
  if (err.hint !== undefined) client.hint = err.hint;
  return client;
}

export interface RpcQueryState<T> {
  data: T | null;
  error: RpcError | null;
  loading: boolean;
}

export interface RpcQueryOptions {
  // Poll interval in ms. Omit for a single fetch.
  pollMs?: number;
  // Skip the request entirely (e.g. a detail query with no selection yet).
  enabled?: boolean;
}

// Polling read. Refetches on `[method, params, pollMs, enabled]` change and every `pollMs` while
// mounted; aborts the in-flight request on teardown. Errors land in `state.error` (not the global
// dialog) so a view can render them inline without a modal storm on every poll tick.
export function useRpcQuery<M extends MethodName>(
  method: M,
  params: MethodInput<M>,
  options: RpcQueryOptions = {},
): RpcQueryState<MethodResult<M>> {
  const { pollMs, enabled = true } = options;
  const [data, setData] = useState<MethodResult<M> | null>(null);
  const [error, setError] = useState<RpcError | null>(null);
  const [loading, setLoading] = useState(enabled);

  // params is a fresh object each render — key on its JSON so the effect only re-runs on a real
  // change, and read the latest object through a ref inside the effect.
  const key = JSON.stringify(params ?? {});
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();

    const run = async () => {
      try {
        const result = await rpc(method, paramsRef.current, { signal: controller.signal });
        if (!active) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        setError(toRpcError(err));
      } finally {
        if (active) setLoading(false);
      }
    };

    setLoading(true);
    void run();
    const timer = pollMs === undefined ? null : setInterval(() => void run(), pollMs);

    return () => {
      active = false;
      controller.abort();
      if (timer !== null) clearInterval(timer);
    };
  }, [method, key, pollMs, enabled]);

  return { data, error, loading };
}

export interface RpcAction {
  // Runs a mutation; resolves to the result, or null if it failed (the error was raised to the
  // ErrorProvider dialog).
  run: <M extends MethodName>(
    method: M,
    params: MethodInput<M>,
  ) => Promise<MethodResult<M> | null>;
  pending: boolean;
}

// Mutations (containers.restart / kill / pause, stacks.up / down). Surfaces failures to the
// ErrorProvider dialog and reports in-flight state via `pending`.
export function useRpcAction(): RpcAction {
  const { raise } = useError();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <M extends MethodName>(
      method: M,
      params: MethodInput<M>,
    ): Promise<MethodResult<M> | null> => {
      setPending(true);
      try {
        return await rpc(method, params);
      } catch (err) {
        raise(toClientError(toRpcError(err)));
        return null;
      } finally {
        setPending(false);
      }
    },
    [raise],
  );

  return { run, pending };
}
