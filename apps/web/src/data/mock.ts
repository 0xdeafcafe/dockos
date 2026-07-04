import type { ContainerState } from "../ui/text.tsx"

// Phase 0 mock data — shaped like a real homelab stack so the UI reads true.
// Phase 1 replaces this with the RPC client + SSE streams.

export interface Container {
  id: string
  name: string
  stack: string
  state: ContainerState
  cpu: number
  cpuHistory: number[]
  mem: string
  memHistory: number[]
  net: string
  uptime: string
}

function history(base: number, spread: number): number[] {
  const out: number[] = []
  let v = base
  for (let i = 0; i < 48; i += 1) {
    v = Math.max(2, Math.min(100, v + Math.sin(i / 1.7) * spread + ((i % 4) - 1.5)))
    out.push(Math.round(v))
  }
  return out
}

interface Seed {
  name: string
  stack: string
  state: ContainerState
  cpu: number
  mem: string
  memBase: number
  net: string
  uptime: string
}

const SEEDS: Seed[] = [
  { name: "proxy", stack: "core", state: "up", cpu: 3, mem: "88M/512M", memBase: 18, net: "↑1M ↓4M", uptime: "14d" },
  { name: "auth", stack: "core", state: "up", cpu: 1, mem: "141/256M", memBase: 55, net: "↑12k ↓40k", uptime: "14d" },
  { name: "dns", stack: "core", state: "up", cpu: 1, mem: "45/128M", memBase: 35, net: "↑2M ↓2M", uptime: "14d" },
  { name: "metrics", stack: "observ", state: "up", cpu: 9, mem: "1.1/2.0G", memBase: 55, net: "↑0 ↓210k", uptime: "14d" },
  { name: "dashboard", stack: "observ", state: "up", cpu: 4, mem: "320/512M", memBase: 62, net: "↑8k ↓22k", uptime: "14d" },
  { name: "logs", stack: "observ", state: "up", cpu: 3, mem: "210/512M", memBase: 40, net: "↑1k ↓90k", uptime: "14d" },
  { name: "media", stack: "media", state: "unhealthy", cpu: 22, mem: "498/512M", memBase: 96, net: "↑2M ↓18M", uptime: "6h" },
  { name: "catalog", stack: "media", state: "up", cpu: 5, mem: "302/512M", memBase: 59, net: "↑1M ↓9M", uptime: "6h" },
  { name: "indexer", stack: "media", state: "up", cpu: 2, mem: "160/512M", memBase: 31, net: "↑300k ↓2M", uptime: "6h" },
  { name: "worker", stack: "→vpn", state: "paused", cpu: 11, mem: "2.1/3.0G", memBase: 70, net: "↑9M ↓44M", uptime: "6h" },
  { name: "gateway", stack: "media", state: "up", cpu: 6, mem: "64/256M", memBase: 25, net: "↑11M ↓52M", uptime: "6h" },
  { name: "seed-job", stack: "seed", state: "exited", cpu: 0, mem: "exited(0)", memBase: 0, net: "—", uptime: "—" },
  { name: "app", stack: "data", state: "up", cpu: 7, mem: "720/750M", memBase: 82, net: "↑40k ↓88k", uptime: "2d" },
  { name: "warehouse", stack: "data", state: "up", cpu: 13, mem: "3.4/4.0G", memBase: 85, net: "↑0 ↓1.2M", uptime: "2d" },
  { name: "db", stack: "data", state: "up", cpu: 2, mem: "180/512M", memBase: 35, net: "↑5k ↓9k", uptime: "2d" },
]

export const FLEET: Container[] = SEEDS.map((s, i) => ({
  id: `c${i}${s.name.slice(0, 3)}`,
  name: s.name,
  stack: s.stack,
  state: s.state,
  cpu: s.cpu,
  cpuHistory: s.state === "exited" ? new Array<number>(48).fill(0) : history(s.cpu, 8),
  mem: s.mem,
  memHistory: s.state === "exited" ? new Array<number>(48).fill(0) : history(s.memBase, 5),
  net: s.net,
  uptime: s.uptime,
}))

export function tickContainer(c: Container): Container {
  if (c.state === "exited") return c
  // small-delta random walk drifting home toward the baseline — sparks tell stories, not noise
  const lastCpu = c.cpuHistory.at(-1) ?? c.cpu
  const homePull = (c.cpu - lastCpu) * 0.15
  const nextCpu = Math.max(1, Math.min(100, lastCpu + homePull + (Math.random() * 4 - 2)))
  const lastMem = c.memHistory.at(-1) ?? 0
  const nextMem = Math.max(1, Math.min(100, lastMem + (Math.random() * 2 - 1)))
  return {
    ...c,
    cpu: nextCpu,
    cpuHistory: [...c.cpuHistory.slice(1), nextCpu],
    memHistory: [...c.memHistory.slice(1), nextMem],
  }
}

export const HOST = {
  engine: "29.0.3",
  uptime: "14d 6h",
  running: 23,
  total: 31,
  images: 41,
  volumes: 18,
  networks: 6,
  cpu: 41,
  memText: "11.2/16G",
  disk: 63,
}

// Host-level telemetry for the SYSTEM view (phase 1: node_exporter via prometheus).
export const HOST_HISTORY = {
  cpu: history(41, 7),
  mem: history(70, 3),
}

// Image audit — versions, drift, CVEs (phase 1: registry check + trivy/grype scan).
export interface ImageAudit {
  repo: string
  tag: string
  current: string
  latest: string
  status: "current" | "outdated" | "stale"
  cves: { crit: number; high: number; med: number }
  size: string
}

export const IMAGES: ImageAudit[] = [
  { repo: "example/proxy", tag: "2.10-alpine", current: "2.10.0", latest: "2.10.0", status: "current", cves: { crit: 0, high: 0, med: 1 }, size: "48M" },
  { repo: "example/auth", tag: "4.39", current: "4.39.1", latest: "4.39.4", status: "outdated", cves: { crit: 0, high: 1, med: 2 }, size: "180M" },
  { repo: "example/metrics", tag: "v3.4", current: "3.4.0", latest: "3.4.0", status: "current", cves: { crit: 0, high: 0, med: 0 }, size: "295M" },
  { repo: "example/dashboard", tag: "12.0", current: "12.0.1", latest: "12.1.0", status: "outdated", cves: { crit: 0, high: 0, med: 3 }, size: "620M" },
  { repo: "example/logs", tag: "3.5", current: "3.5.0", latest: "3.5.2", status: "outdated", cves: { crit: 0, high: 0, med: 1 }, size: "110M" },
  { repo: "example/media", tag: "4.0", current: "4.0.10", latest: "4.0.15", status: "outdated", cves: { crit: 1, high: 2, med: 4 }, size: "410M" },
  { repo: "example/catalog", tag: "5.9", current: "5.9.1", latest: "5.9.1", status: "current", cves: { crit: 0, high: 1, med: 3 }, size: "390M" },
  { repo: "example/worker", tag: "latest", current: "5.0.2", latest: "unknown", status: "stale", cves: { crit: 0, high: 2, med: 5 }, size: "220M" },
  { repo: "example/gateway", tag: "v3.40", current: "3.40.0", latest: "3.40.0", status: "current", cves: { crit: 0, high: 0, med: 0 }, size: "38M" },
  { repo: "example/warehouse", tag: "24", current: "24.8.4", latest: "24.12.1", status: "outdated", cves: { crit: 2, high: 3, med: 8 }, size: "1.1G" },
  { repo: "example/db", tag: "16-alpine", current: "16.6", latest: "16.6", status: "current", cves: { crit: 0, high: 0, med: 0 }, size: "240M" },
  { repo: "example/app", tag: "latest", current: "sha-a1b2c3d", latest: "unknown", status: "stale", cves: { crit: 0, high: 1, med: 6 }, size: "890M" },
]

// Volume audit — rails on disk, what mounts them, what's been orphaned (phase 1: engine
// volume ls/inspect + df). usedBy empty = dangling: no container claims it, safe to reap.
export interface Volume {
  name: string
  driver: string
  mountpoint: string
  size: string
  usedBy: string[]
  created: string
}

export const VOLUMES: Volume[] = [
  { name: "proxy-data", driver: "local", mountpoint: "/var/lib/docker/volumes/proxy-data/_data", size: "12M", usedBy: ["proxy"], created: "14d" },
  { name: "proxy-config", driver: "local", mountpoint: "/var/lib/docker/volumes/proxy-config/_data", size: "4M", usedBy: ["proxy"], created: "14d" },
  { name: "metrics-tsdb", driver: "local", mountpoint: "/var/lib/docker/volumes/metrics-tsdb/_data", size: "3.2G", usedBy: ["metrics"], created: "14d" },
  { name: "dashboard-data", driver: "local", mountpoint: "/var/lib/docker/volumes/dashboard-data/_data", size: "88M", usedBy: ["dashboard"], created: "14d" },
  { name: "logs-data", driver: "local", mountpoint: "/var/lib/docker/volumes/logs-data/_data", size: "1.1G", usedBy: ["logs"], created: "14d" },
  { name: "warehouse-data", driver: "local", mountpoint: "/var/lib/docker/volumes/warehouse-data/_data", size: "6.4G", usedBy: ["warehouse"], created: "2d" },
  { name: "db-data", driver: "local", mountpoint: "/var/lib/docker/volumes/db-data/_data", size: "540M", usedBy: ["db"], created: "2d" },
  { name: "media-config", driver: "local", mountpoint: "/var/lib/docker/volumes/media-config/_data", size: "210M", usedBy: ["media"], created: "6h" },
  { name: "media_orphan_cache", driver: "local", mountpoint: "/var/lib/docker/volumes/media_orphan_cache/_data", size: "780M", usedBy: [], created: "22d" },
  { name: "5f3ac91b7e2d…anon", driver: "local", mountpoint: "/var/lib/docker/volumes/5f3ac91b7e2d/_data", size: "1.4G", usedBy: [], created: "9d" },
  { name: "old_db_data", driver: "local", mountpoint: "/var/lib/docker/volumes/old_db_data/_data", size: "480M", usedBy: [], created: "61d" },
]

export interface Profile {
  name: string
  state: "up" | "partial" | "down"
  services: string
  cpu: string
  mem: string
  note?: string
}

export const PROFILES: Profile[] = [
  { name: "(default)", state: "up", services: "13/13", cpu: "18%", mem: "3.1G" },
  {
    name: "media",
    state: "up",
    services: "10/10",
    cpu: "44%",
    mem: "5.8G",
    note: "recreate briefly drops worker (shares gateway netns)",
  },
  { name: "data", state: "up", services: "7/7", cpu: "21%", mem: "8.2G" },
  { name: "public", state: "partial", services: "1/1", cpu: "1%", mem: "40M" },
  { name: "seed", state: "down", services: "0/2", cpu: "—", mem: "—", note: "one-shot: up runs then exits" },
]

// Per-unit engine identity — image/ports/mounts/networks, shaped like the real stack.
// Phase 1 reads this straight off the engine inspect.
export interface ContainerDetail {
  image: string
  created: string
  restart: string
  health: string
  ip: string
  ports: string[]
  mounts: string[]
  networks: string[]
}

const DETAILS: Record<string, Partial<ContainerDetail>> = {
  proxy: {
    image: "example/proxy:2.10-alpine",
    ports: ["0.0.0.0:80 → 80/tcp", "0.0.0.0:443 → 443/tcp"],
    mounts: ["proxy-data → /data", "proxy-config → /config", "./proxy.conf → /etc/proxy ro"],
    health: "healthy · probed 12s ago",
  },
  auth: {
    image: "example/auth:4.39",
    ports: ["9091/tcp (internal)"],
    mounts: ["./auth → /config"],
  },
  metrics: {
    image: "example/metrics:v3.4",
    ports: ["9090/tcp (internal)"],
    mounts: ["metrics-tsdb → /metrics", "./metrics.yml → /etc ro"],
  },
  dashboard: {
    image: "example/dashboard:12.0",
    ports: ["3000/tcp (internal)"],
    mounts: ["dashboard-data → /var/lib/dashboard"],
  },
  media: {
    image: "example/media:4.0",
    ports: ["0.0.0.0:8989 → 8989/tcp"],
    mounts: ["/data → /data ▤ shared", "media-config → /config"],
    health: "✖ failing · disk /data 96%",
  },
  worker: {
    image: "example/worker:5.0",
    ports: ["via gateway netns"],
    networks: ["container:gateway (vpn netns)"],
    mounts: ["/data/store → /data/store ▤"],
  },
  gateway: {
    image: "example/gateway:v3.40",
    ports: ["0.0.0.0:8080 → 8080/tcp (worker ui)"],
    networks: ["homelab_default + vpn tunnel"],
  },
  app: { image: "example/app:latest", ports: ["8080/tcp (internal)"] },
  warehouse: {
    image: "example/warehouse:24",
    mounts: ["warehouse-data → /var/lib/warehouse"],
  },
  db: { image: "example/db:16-alpine", mounts: ["db-data → /var/lib/db/data"] },
}

export function detailFor(c: Container): ContainerDetail {
  const d = DETAILS[c.name] ?? {}
  return {
    image: d.image ?? `example/${c.name}:latest`,
    created: d.created ?? "2026-06-20 14:02",
    restart: d.restart ?? "unless-stopped",
    health:
      d.health ??
      (c.state === "unhealthy" ? "✖ failing" : c.state === "up" ? "healthy" : "no probe"),
    ip: d.ip ?? `172.20.0.${(c.id.charCodeAt(1) % 40) + 2}`,
    ports: d.ports ?? ["(internal only)"],
    mounts: d.mounts ?? [`${c.name}-config → /config`],
    networks: d.networks ?? ["homelab_default"],
  }
}

export type LogLevel = "info" | "warn" | "error" | "debug"

export interface LogLine {
  id: number
  time: string
  level: LogLevel
  source: string
  msg: string
}

const LOG_POOL: Array<[LogLevel, string, string]> = [
  ["info", "Http", "GET /api/v3/queue 200 14ms"],
  ["info", "Sync", "refreshing 4 sources · 0 new"],
  ["warn", "Worker", "job stalled (retries=0) #4412"],
  ["info", "Ingest", "importing 'batch-0342.dat' → /data/store"],
  ["info", "Ingest", "imported 1 file · link ok"],
  ["error", "Http", "health check failed: disk /data 96% full"],
  ["debug", "Housekeeping", "trimmed 220 rows from Logs table"],
  ["info", "Scheduler", "next sync in 12m"],
  ["warn", "Upstream", "source 'mirror-2' slow (2.1s)"],
]

let logSeq = 0
export function makeLogLine(agoMs = 0): LogLine {
  const [level, source, msg] = LOG_POOL[Math.floor(Math.random() * LOG_POOL.length)] ?? LOG_POOL[0]!
  logSeq += 1
  return { id: logSeq, time: new Date(Date.now() - agoMs).toLocaleTimeString("en-GB"), level, source, msg }
}

// Seeded backlog spread over the last ~10 minutes so history reads as history, not a broken clock.
export function seedLogLines(n: number): LogLine[] {
  return Array.from({ length: n }, (_, i) => makeLogLine((n - i) * 20_000))
}

// Per-container env identity — the same sheet on every unit breaks the fiction.
export function envFor(name: string): EnvVar[] {
  const common: EnvVar[] = [
    { key: "TZ", value: "Etc/UTC", secret: false },
    { key: "PUID", value: "501", secret: false },
  ]
  const byName: Record<string, EnvVar[]> = {
    proxy: [{ key: "PROXY_API_TOKEN", value: "example-secret-000", secret: true }],
    auth: [
      { key: "AUTH_SESSION_CACHE_PASSWORD", value: "example-secret-000", secret: true },
      { key: "AUTH_JWT_SECRET", value: "example-secret-000", secret: true },
    ],
    dashboard: [{ key: "DASHBOARD_ROOT_URL", value: "https://dashboard.example.internal", secret: false }],
    media: [{ key: "MEDIA_API_KEY", value: "example-secret-000", secret: true }],
    app: ENV_VARS,
  }
  return [...common, ...(byName[name] ?? [{ key: "LOG_LEVEL", value: "info", secret: false }])]
}

export interface EnvVar {
  key: string
  value: string
  secret: boolean
}

// Fake values — the point is the redaction UX; real docking masks server-side.
export const ENV_VARS: EnvVar[] = [
  { key: "NODE_ENV", value: "production", secret: false },
  { key: "PORT", value: "8080", secret: false },
  { key: "APP_ENDPOINT", value: "http://app:8080", secret: false },
  { key: "DATABASE_URL", value: "postgres://app:example-secret-000@db:5432/appdb", secret: true },
  { key: "LLM_API_KEY", value: "example-secret-000", secret: true },
  { key: "DB_PASSWORD", value: "example-secret-000", secret: true },
  { key: "WAREHOUSE_PASSWORD", value: "example-secret-000", secret: true },
  { key: "API_TOKEN", value: "example-secret-000", secret: true },
  { key: "LOG_LEVEL", value: "info", secret: false },
]
