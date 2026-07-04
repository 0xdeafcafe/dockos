import { RpcFailure } from "@dockos/contract";
import type {
  AuthSessionResult,
  ConfigGetResult,
  MethodInput,
  MethodName,
  MethodResult,
  NetworksListResult,
  SerializedError,
} from "@dockos/contract";
import {
  envFor,
  FLEET,
  HOST,
  HOST_HISTORY,
  PROFILES,
  seedLogLines,
  tickContainer,
} from "../data/mock.ts";
import type { Container } from "../data/mock.ts";

// The docking RPC client. One typed `rpc(method, params)` call → `POST /rpc/<method>` with the
// params as the JSON body, parsing the `{ ok, data } | { ok, error }` envelope (see
// packages/contract/src/rpc.ts). On `{ ok: false }` it throws an `RpcError` carrying the
// server's SerializedError (kind / message / meta / hint / httpStatus). Types are derived from
// the contract's method map, so `rpc("containers.list", {})` is fully checked both ways.
//
// A `VITE_USE_MOCK` flag (default ON) routes every call to the existing phase-0 mock.ts data so
// the UI runs without a server. Set `VITE_USE_MOCK=false` to hit the real backend. `VITE_API_BASE`
// prefixes the request URL (empty string → same origin, which is how the SPA is served).

const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";
// Default true "for now" — the app must work before the server is wired up. Only an explicit
// "false" turns HTTP on.
const USE_MOCK: boolean = (import.meta.env.VITE_USE_MOCK ?? "true") !== "false";

export interface RpcOptions {
  signal?: AbortSignal;
}

// The single error type the client throws. Fields mirror the contract's SerializedError, so it
// maps 1:1 onto the ErrorProvider's ClientError ({ kind, message, meta?, hint? }).
export class RpcError extends Error {
  readonly kind: string;
  readonly meta: Record<string, unknown>;
  readonly hint: string | undefined;
  readonly httpStatus: number;

  constructor(error: SerializedError) {
    super(error.message);
    this.name = "RpcError";
    this.kind = error.kind;
    this.meta = error.meta;
    this.hint = error.hint;
    this.httpStatus = error.httpStatus;
  }
}

function internalError(message: string, httpStatus: number): RpcError {
  return new RpcError({ kind: "internal", message, meta: {}, httpStatus });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function rpc<M extends MethodName>(
  method: M,
  params: MethodInput<M>,
  opts: RpcOptions = {},
): Promise<MethodResult<M>> {
  if (USE_MOCK) return mockRpc(method, params);

  const res = await fetch(`${API_BASE}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params ?? {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  const body: unknown = await res.json().catch(() => null);
  if (isRecord(body) && body.ok === true && "data" in body) {
    return body.data as MethodResult<M>;
  }
  const failure = RpcFailure.safeParse(body);
  if (failure.success) throw new RpcError(failure.data.error);
  throw internalError(`request to ${method} failed (${res.status})`, res.status);
}

// ── Mock fallback ───────────────────────────────────────────────────────────────────────────────
// Each handler is keyed by method and typed against the contract, so the mock shapes are checked
// to match what the real server returns. Backed by the phase-0 mock.ts data.

type MockHandlers = {
  [M in MethodName]: (params: MethodInput<M>) => MethodResult<M>;
};

function nameOfId(id: string): string {
  return FLEET.find((c) => c.id === id)?.name ?? id;
}

// mock.ts has no networks fixture — synthesize a small plausible set (documented gap in adapt.ts).
const MOCK_NETWORKS: NetworksListResult["networks"] = [
  {
    id: "net_homelab_default",
    name: "homelab_default",
    driver: "bridge",
    scope: "local",
    internal: false,
    containers: ["proxy", "auth", "metrics", "dashboard", "logs"],
  },
  {
    id: "net_media",
    name: "media_default",
    driver: "bridge",
    scope: "local",
    internal: false,
    containers: ["media", "catalog", "indexer", "gateway"],
  },
  {
    id: "net_data",
    name: "data_default",
    driver: "bridge",
    scope: "local",
    internal: true,
    containers: ["app", "warehouse", "db"],
  },
];

// mock.ts has no config/session fixtures — a permissive default so every action stays enabled.
const MOCK_CONFIG: ConfigGetResult = {
  readOnly: false,
  capabilities: { restart: true, stop: true, pause: true, profiles: true },
  ui: { density: "comfortable" },
  auth: { mode: "dev", loginUrl: null },
  metrics: true,
};

const MOCK_SESSION: AuthSessionResult = {
  operator: { username: "operator", email: "operator@example.internal", name: "Operator", groups: ["admins"] },
};

// Stateful mock so the fleet still feels alive without a server: containers.list ticks the
// sparklines on every poll (the phase-0 tickContainer interval, now driven by the poll itself),
// and the host-history walk drifts so the SYSTEM + telemetry charts move. Module-level so each
// poll advances the same series.
let mockFleet: Container[] | null = null;
function fleetTick(): Container[] {
  if (mockFleet === null) {
    mockFleet = FLEET.map((c) => ({ ...c }));
  } else {
    mockFleet = mockFleet.map((c) =>
      c.state === "paused" || c.state === "exited" ? c : tickContainer(c),
    );
  }
  return mockFleet;
}

function walk(prev: number[], base: number): number[] {
  const last = prev.at(-1) ?? base;
  const next = Math.max(2, Math.min(98, last + (base - last) * 0.1 + (Math.random() * 6 - 3)));
  return [...prev.slice(1), next];
}
let mockHostHist: { cpu: number[]; mem: number[] } | null = null;
function hostHistTick(): { cpu: number[]; mem: number[] } {
  if (mockHostHist === null) {
    mockHostHist = { cpu: [...HOST_HISTORY.cpu], mem: [...HOST_HISTORY.mem] };
  } else {
    mockHostHist = { cpu: walk(mockHostHist.cpu, 41), mem: walk(mockHostHist.mem, 70) };
  }
  return mockHostHist;
}

const mockHandlers: MockHandlers = {
  "health.ping": () => ({ pong: true, at: Date.now() }),
  "auth.session": () => MOCK_SESSION,
  "auth.signout": () => ({ redirectUrl: null }),
  "config.get": () => MOCK_CONFIG,
  "containers.list": (params) => {
    const list = fleetTick();
    return { containers: params.stack ? list.filter((c) => c.stack === params.stack) : list };
  },
  "containers.restart": (params) => ({ id: params.id, state: "up" }),
  "containers.kill": (params) => ({ id: params.id, state: "exited" }),
  "containers.pause": (params) => ({
    id: params.id,
    state: FLEET.find((c) => c.id === params.id)?.state === "paused" ? "up" : "paused",
  }),
  "containers.logs": (params) => ({ lines: seedLogLines(params.tail ?? 50) }),
  "containers.env": (params) => ({ env: envFor(nameOfId(params.id)) }),
  "stacks.list": () => ({ stacks: PROFILES }),
  "stacks.up": (params) => ({ name: params.name, started: [], skipped: [] }),
  "stacks.down": (params) => ({ name: params.name, stopped: [], skipped: [] }),
  "networks.list": () => ({ networks: MOCK_NETWORKS }),
  "host.info": () => HOST,
  "metrics.host": () => ({ cpu: HOST.cpu, mem: 70, memText: HOST.memText, disk: HOST.disk }),
  "metrics.hostHistory": () => hostHistTick(),
  "metrics.containerHistory": (params) => {
    const c = FLEET.find((x) => x.id === params.id || x.name === params.name);
    return { cpu: c?.cpuHistory ?? [], mem: c?.memHistory ?? [] };
  },
};

function mockRpc<M extends MethodName>(
  method: M,
  params: MethodInput<M>,
): Promise<MethodResult<M>> {
  const handler = mockHandlers[method] as (p: MethodInput<M>) => MethodResult<M>;
  return Promise.resolve(handler(params));
}
