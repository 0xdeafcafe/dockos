# RPC data layer (`apps/web/src/rpc`)

The typed bridge from the docking web app to its `@dockos/server` RPC backend. Replaces the
phase-0 mock data with real calls — while still running on the mock when no server is up.

## Files

- **`client.ts`** — `rpc(method, params, opts?)`. Single `POST /rpc/<method>` with the params as
  the JSON body; parses the `{ ok, data } | { ok, error }` envelope. On `{ ok: false }` it throws
  an `RpcError` carrying the server's `SerializedError` (`kind` / `message` / `meta` / `hint` /
  `httpStatus`). Fully typed off the contract's method map. Also holds the mock fallback.
- **`hooks.ts`** — `useRpcQuery` (polling reads) and `useRpcAction` (mutations).
- **`adapt.ts`** — contract-result → view-shape adapters. Near-identity; see its header for the
  known gaps (Stack↔Profile naming, missing networks/host/detail fixtures).

## `rpc()` signature

```ts
function rpc<M extends MethodName>(
  method: M,
  params: MethodInput<M>,
  opts?: { signal?: AbortSignal },
): Promise<MethodResult<M>>;

// e.g. const { containers } = await rpc("containers.list", {});
//      await rpc("containers.restart", { id });   // throws RpcError on failure
```

## Hooks

```ts
// Polling read. Errors land in state.error (not the global dialog).
const { data, error, loading } = useRpcQuery("containers.list", {}, { pollMs: 1400 });

// Mutation. Failures are raised to the ErrorProvider dialog automatically.
const { run, pending } = useRpcAction();
await run("containers.restart", { id });
```

`useRpcQuery(method, params, { pollMs?, enabled? })` refetches on argument change and every
`pollMs` while mounted, aborting the in-flight request on unmount. `useRpcAction()` returns
`{ run, pending }`; `run` resolves to the result or `null` when it failed (already surfaced).

## Mock fallback

`client.ts` reads two Vite env vars:

- `VITE_USE_MOCK` — **defaults ON**. Every `rpc()` call resolves from the phase-0 `data/mock.ts`
  fixtures instead of hitting HTTP, so the UI runs with no server. Set `VITE_USE_MOCK=false` to
  use the real backend.
- `VITE_API_BASE` — prefixes the request URL (default `""` → same origin, how the SPA is served).

The flag is wired in `client.ts` only; hooks and views are unaware of it.

## Integration guide

To move a view off mock data, swap its mock import for a `useRpcQuery` call and (optionally) an
`adapt.ts` mapper — nothing else changes, because the contract mirrors the mock shapes. For the
fleet, `useFleet` currently seeds state from the `FLEET` constant and mutates it locally; the RPC
version reads `const { data } = useRpcQuery("containers.list", {}, { pollMs: 1400 })` and feeds
`adaptFleet(data)` (a typed identity returning `Container[]`) into the same state, while the
`kill` / `restart` / `pause` handlers call `useRpcAction().run("containers.restart", { id })` (etc.)
and let the poll refresh the list — the SUPERHOT animation choreography stays exactly as-is, only
its data source changes. Because `VITE_USE_MOCK` defaults ON, that swapped view keeps working
against the mock until the server is switched on with `VITE_USE_MOCK=false`.
