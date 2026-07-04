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
  detailFor,
  envFor,
  FLEET,
  HOST,
  HOST_HISTORY,
  IMAGES,
  PROFILES,
  seedLogLines,
  tickContainer,
  VOLUMES,
} from "../data/mock.ts";
import type { Container } from "../data/mock.ts";
import { DEMO } from "../demo.ts";

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
// The GitHub Pages demo has no backend to reach, so it ALWAYS routes to the mock — VITE_USE_MOCK
// can't turn HTTP on there. Otherwise the flag decides: default true "for now" (the app must work
// before the server is wired up), and only an explicit "false" turns HTTP on.
const USE_MOCK: boolean = DEMO || (import.meta.env.VITE_USE_MOCK ?? "true") !== "false";

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
    // send the HttpOnly session cookie — the server now enforces auth on every non-public method
    credentials: "same-origin",
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
  cve: true,
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

// A small fake container filesystem so the demo's FILES tab can actually be BROWSED — every dir
// resolves to its own listing, so clicking into config/ data/ certs/ works. Unknown paths read as
// empty. (Real deploys read the container over the archive API.)
const MOCK_FS: Record<string, { name: string; type: "dir" | "file"; size: number }[]> = {
  "/": [
    { name: "config", type: "dir", size: 0 },
    { name: "data", type: "dir", size: 0 },
    { name: "app.log", type: "file", size: 48213 },
    { name: "entrypoint.sh", type: "file", size: 512 },
  ],
  "/config": [
    { name: "settings.yaml", type: "file", size: 2048 },
    { name: "logging.conf", type: "file", size: 640 },
    { name: "certs", type: "dir", size: 0 },
  ],
  "/config/certs": [
    { name: "fullchain.pem", type: "file", size: 3821 },
    { name: "privkey.pem", type: "file", size: 1704 },
  ],
  "/data": [
    { name: "app.db", type: "file", size: 1048576 },
    { name: "uploads", type: "dir", size: 0 },
    { name: "backups", type: "dir", size: 0 },
  ],
  "/data/uploads": [
    { name: "poster-01.jpg", type: "file", size: 245113 },
    { name: "poster-02.jpg", type: "file", size: 198442 },
  ],
  "/data/backups": [
    { name: "2026-07-01.tar.gz", type: "file", size: 8830112 },
    { name: "2026-07-02.tar.gz", type: "file", size: 8912344 },
  ],
};
const MOCK_FILE_TEXT: Record<string, string> = {
  "/entrypoint.sh": '#!/bin/sh\nset -e\n\necho "starting ${APP_NAME:-service}"\nexec "$@"\n',
  "/config/settings.yaml": "server:\n  host: 0.0.0.0\n  port: 8080\nlog_level: info\ntls:\n  enabled: true\n",
  "/config/logging.conf": "[loggers]\nkeys=root\n\n[handler_console]\nclass=StreamHandler\nlevel=INFO\n",
  "/config/certs/fullchain.pem":
    "-----BEGIN CERTIFICATE-----\nMIIB2z…mock…demo…not…a…real…key…CCAf8wDQYJ\n-----END CERTIFICATE-----\n",
  "/app.log":
    "2026-07-04T05:12:03Z INFO  starting up\n2026-07-04T05:12:04Z INFO  listening on :8080\n2026-07-04T05:12:09Z WARN  slow query 214ms\n2026-07-04T05:13:41Z INFO  gc pause 4ms\n",
};
// normalise the requested path to leading-slash / no-trailing-slash so the map lookups are stable
function fsPath(p: string): string {
  const withLead = p.startsWith("/") ? p : `/${p}`;
  return withLead.replace(/\/+$/, "") || "/";
}
const BINARY_FILE = /\.(jpg|jpeg|png|gif|gz|zip|tar|db|bin|woff2?)$/i;

// realistic-looking image ids + ages so the demo's image INSPECT reads like a real registry audit
// (the Image type carries id + age; the base IMAGES fixtures omit them, so fill them here)
const MOCK_IMAGE_IDS = [
  "a1b2c3d4e5f6",
  "b7c8d9e0f1a2",
  "c3d4e5f6a7b8",
  "d9e0f1a2b3c4",
  "e5f6a7b8c9d0",
  "f1a2b3c4d5e6",
  "0a1b2c3d4e5f",
  "1b2c3d4e5f60",
  "2c3d4e5f6071",
  "3d4e5f607182",
  "4e5f60718293",
  "5f6071829304",
];
const MOCK_IMAGE_AGES = ["6d", "3w", "8d", "12d", "5w", "2d", "3d", "4mo", "9d", "18d", "11d", "6mo"];

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
  "containers.inspect": (params) => {
    const list = fleetTick();
    const c = list.find((x) => x.id === params.id);
    const base = c
      ? detailFor(c)
      : { image: "—", created: "—", restart: "no", health: "—", ip: "—", ports: [], mounts: [], networks: [] };
    const peers = c
      ? list
          .filter((x) => x.stack === c.stack && x.id !== c.id)
          .slice(0, 3)
          .map((x) => ({ name: x.name, reason: `net · ${c.stack}_default` }))
      : [];
    const registers = [
      { label: "PIDS", value: "14" },
      { label: "NET", value: "↓ 18.4G · ↑ 2.1G" },
      { label: "BLKIO", value: "r 402M · w 1.2G" },
      { label: "THROTTLED", value: "0.4%" },
      { label: "RESTARTS", value: "2" },
      { label: "OOM KILLED", value: "no" },
    ];
    return { ...base, peers, registers };
  },
  "containers.files": (params) => {
    const path = fsPath(params.path || "/");
    return { path, entries: MOCK_FS[path] ?? [], truncated: false };
  },
  "containers.file": (params) => {
    const path = fsPath(params.path);
    const binary = BINARY_FILE.test(path);
    return {
      path: params.path,
      content: binary
        ? ""
        : (MOCK_FILE_TEXT[path] ??
          `# ${params.path}\n# mock preview — the real browse reads the container via the archive API\nKEY=value\n`),
      truncated: false,
      binary,
    };
  },
  "containers.compose": (params) => {
    const c = fleetTick().find((x) => x.id === params.id);
    const name = c?.name ?? "service";
    return {
      service: name,
      yaml: `  ${name}:\n    image: example/${name}:latest\n    restart: unless-stopped\n    networks:\n      - default\n    # mock — the real view reads the compose file the container was created from`,
    };
  },
  "stacks.list": () => ({ stacks: PROFILES }),
  "stacks.up": (params) => ({ name: params.name, started: [], skipped: [] }),
  "stacks.down": (params) => ({ name: params.name, stopped: [], skipped: [] }),
  "networks.list": () => ({ networks: MOCK_NETWORKS }),
  "images.list": () => ({
    images: IMAGES.map((img, i) => ({
      ...img,
      id: MOCK_IMAGE_IDS[i] ?? `abcdef${String(i).padStart(6, "0")}`,
      age: MOCK_IMAGE_AGES[i] ?? "—",
    })),
  }),
  "volumes.list": () => ({ volumes: VOLUMES }),
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
