// Phase 0 mock filesystem — believable per-container trees so the FILES tab reads true.
// Phase 1 backs this with `docker exec ls`-shaped RPC + a ranged file-read call.
// Standalone by design: the fleet names below are duplicated from data/mock.ts SEEDS
// rather than imported, so this module survives the fleet mock being rewritten.

export interface FsNode {
  name: string
  kind: "dir" | "file"
  mode: string
  size: number
  mtime: string
  mounted?: boolean // ▤ — path is a bind/volume mount
  children?: FsNode[] // dirs only
  lines?: string[] // text files only; absent ⇒ binary
}

const KB = 1024
const MB = 1024 * KB
const GB = 1024 * MB

// bigger than this and the preview refuses politely, even for text
export const PREVIEW_MAX = 256 * KB

export function isTextPreview(n: FsNode): boolean {
  return n.kind === "file" && n.lines !== undefined && n.size <= PREVIEW_MAX
}

export function fmtSize(bytes: number): string {
  const units: Array<[number, string]> = [
    [GB, "G"],
    [MB, "M"],
    [KB, "K"],
  ]
  for (const [mag, suffix] of units) {
    if (bytes >= mag) {
      const v = bytes / mag
      return (v >= 10 ? String(Math.round(v)) : v.toFixed(1)) + suffix
    }
  }
  return String(bytes)
}

// a handful of fixed timestamps — image layers are old, configs newer, logs hot
const T = {
  image: "may 11 08:30",
  deploy: "jun 20 14:02",
  conf: "jun 28 09:41",
  data: "jul 01 22:15",
  log: "jul 03 04:11",
}

function d(name: string, children: FsNode[], opts: { mounted?: boolean; mtime?: string } = {}): FsNode {
  return {
    name,
    kind: "dir",
    mode: "drwxr-xr-x",
    size: 4 * KB,
    mtime: opts.mtime ?? T.deploy,
    ...(opts.mounted ? { mounted: true } : {}),
    children,
  }
}

function f(name: string, size: number, mtime: string, lines?: string[]): FsNode {
  return { name, kind: "file", mode: "-rw-r--r--", size, mtime, ...(lines ? { lines } : {}) }
}

// executable — always binary
function x(name: string, size: number, mtime: string): FsNode {
  return { name, kind: "file", mode: "-rwxr-xr-x", size, mtime }
}

// tiny deterministic hash so ports/counts differ per container without RNG
function seed(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 9973
  return h
}

function ymlFor(app: string): string[] {
  const port = 3000 + (seed(app) % 6000)
  return [
    "# managed by docking · phase-0 mock",
    "server:",
    "  bind: 0.0.0.0",
    `  port: ${port}`,
    "  url_base: /",
    "log:",
    "  level: info",
    "  rotate: 5",
    "auth:",
    "  method: forms",
    "  api_key: ******** # sealed — see ENV tab",
    "update:",
    "  branch: main",
    "  mechanism: docker",
  ]
}

function logFor(app: string): string[] {
  return [
    `04:10:41 INF ${app} started pid=1`,
    "04:10:41 INF migrations up-to-date (0 pending)",
    "04:10:42 INF listening on 0.0.0.0",
    "04:11:02 INF scheduler: 6 tasks registered",
    "04:11:02 DBG housekeeping: trimmed 220 rows",
    "04:12:18 INF GET /api/v3/health 200 4ms",
    "04:14:55 WRN upstream slow (2.1s), retrying",
    "04:14:56 INF retry ok (210ms)",
    "04:19:03 INF rss sync: 4 feeds, 0 new",
    "04:23:40 INF GET /api/v3/queue 200 14ms",
  ]
}

function errFor(app: string): string[] {
  return [
    `jun 30 02:11 ${app}: EPIPE writing response (client gone)`,
    "jul 01 22:15 disk watermark warning: /data 91%",
    "jul 03 04:11 health probe: slow response (1980ms)",
  ]
}

function shFor(app: string): string[] {
  return [
    "#!/bin/sh",
    "set -eu",
    'exec 2>&1',
    `echo "[run] starting ${app}"`,
    `exec /app/${app} --config /config/config.yml`,
  ]
}

const HOSTS = [
  "127.0.0.1  localhost",
  "::1        localhost ip6-localhost",
  "172.20.0.7 container.homelab_default",
]

// media apps share the /data library mount — marked ▤ like the fleet's mount notation
const MEDIA = new Set(["media", "catalog", "indexer", "worker"])

function dataTree(): FsNode {
  return d(
    "data",
    [
      d(
        "sets",
        [
          d("set-02", [f("batch-0203.bin", 2.4 * GB, T.data), f("batch-0204.bin", 2.2 * GB, T.data)], {
          mtime: T.data,
          }),
        ],
        { mtime: T.data },
      ),
      d("archive", [f("snapshot-2024.tar", 18 * GB, T.data)], { mtime: T.data }),
      d("incoming", [f("batch-0205.bin.part", 640 * MB, T.log), f("resume.dat", 88 * KB, T.log)], {
        mtime: T.log,
      }),
    ],
    { mounted: true, mtime: T.data },
  )
}

// per-container flavour on top of the shared base tree
interface Flavor {
  etc?: FsNode[]
  varLib?: FsNode[]
  roots?: FsNode[]
}

const FLAVORS: Record<string, Flavor> = {
  proxy: {
    etc: [
      d("proxy", [f("proxy.conf", 4.2 * KB, T.conf, [
        "apps.example.internal {",
        "  encode zstd gzip",
        "  reverse_proxy dashboard:3000",
        "}",
        "media.example.internal {",
        "  forward_auth auth:9091 {",
        "    uri /api/authz/forward-auth",
        "  }",
        "  reverse_proxy media:8989",
        "}",
      ])], { mounted: true }),
    ],
    roots: [
      d("data", [d("proxy", [d("certificates", [f("apps.example.internal.crt", 1.9 * KB, T.conf), f("apps.example.internal.key", 227, T.conf)])])], {
        mounted: true,
      }),
    ],
  },
  metrics: {
    roots: [
      d(
        "metrics",
        [
          d("chunks_head", [f("000841", 128 * MB, T.log)], { mtime: T.log }),
          d("wal", [f("00000042", 96 * MB, T.log), f("checkpoint.00000039", 12 * MB, T.log)], { mtime: T.log }),
          f("lock", 0, T.deploy),
        ],
        { mounted: true, mtime: T.log },
      ),
    ],
  },
  dashboard: {
    varLib: [
      d("dashboard", [f("dashboard.db", 42 * MB, T.log), d("plugins", []), d("png", [])], { mounted: true, mtime: T.log }),
    ],
  },
  db: {
    varLib: [
      d(
        "db",
        [
          d(
            "data",
            [
              d("base", [d("16384", [f("2619", 1.2 * MB, T.log)])], { mtime: T.log }),
              d("wal", [f("00000001000000000000002a", 16 * MB, T.log)], { mtime: T.log }),
              f("db.conf", 29 * KB, T.conf, [
                "listen_addresses = '*'",
                "max_connections = 100",
                "shared_buffers = 128MB",
                "wal_level = replica",
                "log_min_messages = warning",
              ]),
              f("DB_VERSION", 3, T.image, ["16"]),
            ],
            { mounted: true, mtime: T.log },
          ),
        ],
        { mtime: T.log },
      ),
    ],
  },
  warehouse: {
    varLib: [
      d(
        "warehouse",
        [
          d("store", [d("3f2", [f("data.bin", 1.1 * GB, T.log)])], { mtime: T.log }),
          d("metadata", [f("appdb.sql", 6.4 * KB, T.conf, ["ATTACH DATABASE appdb ENGINE = Atomic"])]),
        ],
        { mounted: true, mtime: T.log },
      ),
    ],
  },
}

function baseTree(name: string): FsNode[] {
  const flavor = FLAVORS[name] ?? {}
  const roots: FsNode[] = [
    d("app", [x(name, 24 * MB, T.image), f("run.sh", 412, T.image, shFor(name)), f("VERSION", 6, T.image, ["4.0.8"])], {
      mtime: T.image,
    }),
    d(
      "config",
      [
        f("config.yml", 2.1 * KB, T.conf, ymlFor(name)),
        f(`${name}.db`, 14 * MB, T.log),
        f(`${name}.db-wal`, 4.2 * MB, T.log),
        d("logs", [f(`${name}.txt`, 88 * KB, T.log, logFor(name)), f(`${name}.debug.txt`, 340 * KB, T.log, logFor(name))], {
          mtime: T.log,
        }),
        d("backups", [f(`${name}-2026-07-01.zip`, 9.4 * MB, T.data)], { mtime: T.data }),
      ],
      { mounted: true, mtime: T.conf },
    ),
    ...(MEDIA.has(name) ? [dataTree()] : []),
    d("etc", [
      ...(flavor.etc ?? []),
      f("hosts", 174, T.image, HOSTS),
      f("resolv.conf", 61, T.image, ["nameserver 127.0.0.11", "options ndots:0"]),
      f("timezone", 17, T.image, ["Etc/UTC"]),
    ]),
    ...(flavor.roots ?? []),
    d("var", [
      d("log", [f("app.log", 52 * KB, T.log, logFor(name)), f("error.log", 3.1 * KB, T.log, errFor(name))], {
        mtime: T.log,
      }),
      ...(flavor.varLib ? [d("lib", flavor.varLib, { mtime: T.log })] : []),
      d("cache", []),
    ]),
  ]
  return roots
}

// stable per container: expansion paths and preview refs survive re-renders
const CACHE = new Map<string, FsNode[]>()

export function fsFor(container: string): FsNode[] {
  const hit = CACHE.get(container)
  if (hit) return hit
  const tree = baseTree(container)
  CACHE.set(container, tree)
  return tree
}
