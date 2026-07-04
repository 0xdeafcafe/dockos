import type {
  Container,
  ContainerActionResult,
  ContainerDetail,
  ContainerPeer,
  ContainerState,
  ContainersListParams,
  EnvVar,
  LogLevel,
  LogLine,
} from "@dockos/contract";
import type { ComposeProfileMap } from "../adapters/compose-file.ts";
import { extractServiceBlock, stackOfService } from "../adapters/compose-file.ts";
import type {
  ContainerInspect,
  ContainerStats,
  ContainerSummary,
  DockerEngine,
} from "../ports/docker.ts";
import { compactUptime, formatBytes, formatCount } from "../util/format.ts";
import type { StatsHistoryService, UnitStats } from "./stats-history.ts";
import { HISTORY_LEN } from "./stats-history.ts";

const COMPOSE_SERVICE = "com.docker.compose.service";
const COMPOSE_PROJECT = "com.docker.compose.project";
const STACK_LABEL = "dockos.stack";

const SECRET_KEY = /(?:secret|token|password|passwd|api[_-]?key|apikey|private|credential|auth)/iu;

const LEVEL_ERROR = /\b(?:error|err|fatal|panic)\b/iu;
const LEVEL_WARN = /\b(?:warn|warning)\b/iu;
const LEVEL_DEBUG = /\b(?:debug|trace)\b/iu;

function zeroes(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

function padHistory(history: number[]): number[] {
  if (history.length >= HISTORY_LEN) return [...history];
  return [...zeroes(HISTORY_LEN - history.length), ...history];
}

function summaryState(s: ContainerSummary): ContainerState {
  if (s.State === "paused") return "paused";
  if (s.State === "restarting") return "unhealthy";
  if (s.State === "running") return s.Status.includes("(unhealthy)") ? "unhealthy" : "up";
  return "exited";
}

function inspectState(ins: ContainerInspect): ContainerState {
  if (ins.State.Paused) return "paused";
  if (ins.State.Running) return ins.State.Health?.Status === "unhealthy" ? "unhealthy" : "up";
  if (ins.State.Status === "restarting") return "unhealthy";
  return "exited";
}

// Real unit registers: pids/net/blk/throttle from a live stats snapshot (null → "—" for a stopped
// unit), restarts + oom-killed from inspect.
function buildRegisters(
  ins: ContainerInspect,
  stats: ContainerStats | null,
): Array<{ label: string; value: string }> {
  const D = "—";
  let net = D;
  let blk = D;
  let pids = D;
  let thr = D;
  if (stats) {
    const nets = Object.values(stats.networks ?? {});
    const rx = nets.reduce((s, n) => s + (n.rx_bytes ?? 0), 0);
    const tx = nets.reduce((s, n) => s + (n.tx_bytes ?? 0), 0);
    net = `↓ ${formatBytes(rx)} · ↑ ${formatBytes(tx)}`;
    const io = stats.blkio_stats?.io_service_bytes_recursive ?? [];
    const r = io.filter((e) => e.op.toLowerCase() === "read").reduce((s, e) => s + e.value, 0);
    const w = io.filter((e) => e.op.toLowerCase() === "write").reduce((s, e) => s + e.value, 0);
    blk = `r ${formatBytes(r)} · w ${formatBytes(w)}`;
    pids = String(stats.pids_stats?.current ?? 0);
    const periods = stats.cpu_stats.throttling_data?.periods ?? 0;
    const thrp = stats.cpu_stats.throttling_data?.throttled_periods ?? 0;
    thr = periods > 0 ? `${((thrp / periods) * 100).toFixed(1)}%` : "0%";
  }
  return [
    { label: "PIDS", value: pids },
    { label: "NET", value: net },
    { label: "BLKIO", value: blk },
    { label: "THROTTLED", value: thr },
    { label: "RESTARTS", value: String(ins.RestartCount ?? 0) },
    { label: "OOM KILLED", value: ins.State.OOMKilled ? "✖ yes" : "no" },
  ];
}

function exitedMem(status: string): string {
  const code = /Exited \((\d+)\)/u.exec(status);
  return code ? `exited(${code[1]})` : "—";
}

function levelOf(msg: string): LogLevel {
  if (LEVEL_ERROR.test(msg)) return "error";
  if (LEVEL_WARN.test(msg)) return "warn";
  if (LEVEL_DEBUG.test(msg)) return "debug";
  return "info";
}

interface RawLogLine {
  source: string;
  text: string;
}

// Non-TTY docker logs are multiplexed: 8-byte frame headers [stream, 0, 0, 0, len(u32 BE)].
function demuxLogs(buf: Buffer, tty: boolean): RawLogLine[] {
  const chunks: RawLogLine[] = [];
  if (tty) {
    chunks.push({ source: "stdout", text: buf.toString("utf8") });
  } else {
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const stream = buf[offset] === 2 ? "stderr" : "stdout";
      const size = buf.readUInt32BE(offset + 4);
      const end = Math.min(offset + 8 + size, buf.length);
      chunks.push({ source: stream, text: buf.subarray(offset + 8, end).toString("utf8") });
      offset = end;
    }
  }
  const lines: RawLogLine[] = [];
  const pending = new Map<string, string>();
  for (const chunk of chunks) {
    const text = (pending.get(chunk.source) ?? "") + chunk.text;
    const parts = text.split("\n");
    pending.set(chunk.source, parts.pop() ?? "");
    for (const part of parts) {
      if (part.length > 0) lines.push({ source: chunk.source, text: part });
    }
  }
  for (const [source, rest] of pending) {
    if (rest.length > 0) lines.push({ source, text: rest });
  }
  return lines;
}

function toLogLine(raw: RawLogLine, id: number): LogLine {
  const split = raw.text.indexOf(" ");
  const stamp = split > 0 ? raw.text.slice(0, split) : "";
  const msg = split > 0 ? raw.text.slice(split + 1) : raw.text;
  const parsed = new Date(stamp.replace(/\.(\d{3})\d*Z$/u, ".$1Z"));
  const time = Number.isNaN(parsed.getTime())
    ? new Date().toLocaleTimeString("en-GB")
    : parsed.toLocaleTimeString("en-GB");
  return { id, time, level: levelOf(msg), source: raw.source, msg };
}

export class ContainerService {
  private readonly engine: DockerEngine;
  private readonly stats: StatsHistoryService;
  private readonly compose: ComposeProfileMap | null;
  private readonly composePath: string | undefined;

  constructor(
    engine: DockerEngine,
    stats: StatsHistoryService,
    compose: ComposeProfileMap | null,
    composePath?: string,
  ) {
    this.engine = engine;
    this.stats = stats;
    this.compose = compose;
    this.composePath = composePath;
  }

  // The container's own compose service definition, verbatim from the mounted compose file.
  async composeConfig(id: string): Promise<{ service: string | null; yaml: string }> {
    const ins = await this.engine.inspectContainer(id);
    const service = ins.Config.Labels[COMPOSE_SERVICE] ?? null;
    if (!service || !this.composePath) return { service, yaml: "" };
    return { service, yaml: extractServiceBlock(this.composePath, service) ?? "" };
  }

  async list(params: ContainersListParams): Promise<Container[]> {
    const summaries = await this.engine.listContainers(true);
    const containers = summaries
      .map((s) => this.toContainer(s))
      .toSorted((a, b) => a.name.localeCompare(b.name));
    return params.stack === undefined
      ? containers
      : containers.filter((c) => c.stack === params.stack);
  }

  async restart(id: string): Promise<ContainerActionResult> {
    await this.engine.restartContainer(id);
    return await this.actionResult(id);
  }

  async kill(id: string): Promise<ContainerActionResult> {
    await this.engine.killContainer(id);
    return await this.actionResult(id);
  }

  // Toggle: paused units get unpaused, running units get paused.
  async pause(id: string): Promise<ContainerActionResult> {
    const before = await this.engine.inspectContainer(id);
    await (before.State.Paused ? this.engine.unpauseContainer(id) : this.engine.pauseContainer(id));
    return await this.actionResult(id);
  }

  async logs(id: string, tail: number): Promise<LogLine[]> {
    const ins = await this.engine.inspectContainer(id);
    const buf = await this.engine.containerLogs(id, tail);
    return demuxLogs(buf, ins.Config.Tty).map((raw, i) => toLogLine(raw, i + 1));
  }

  // Secret-looking keys are FLAGGED (secret:true) so the UI masks them by default, but the real
  // value is sent so the operator's audited REVEAL can actually show it — this is the admin's own
  // engine, redacting from themselves is pointless (and made REVEAL show only the mask).
  async env(id: string): Promise<EnvVar[]> {
    const ins = await this.engine.inspectContainer(id);
    return (ins.Config.Env ?? []).map((entry) => {
      const split = entry.indexOf("=");
      const key = split >= 0 ? entry.slice(0, split) : entry;
      const value = split >= 0 ? entry.slice(split + 1) : "";
      return { key, value, secret: SECRET_KEY.test(key) };
    });
  }

  // Real container detail + computed peers: the containers this one is linked to via a shared
  // user-defined network (they can reach each other by name) or a declared compose dependency
  // (the com.docker.compose.depends_on label). Actual packet flow isn't observable from the engine.
  async inspect(id: string): Promise<ContainerDetail> {
    const ins = await this.engine.inspectContainer(id);
    const selfName = ins.Name.replace(/^\//u, "");
    const nets = ins.NetworkSettings?.Networks ?? {};
    const netNames = Object.keys(nets);
    const ip = Object.values(nets)
      .map((n) => n?.IPAddress)
      .find((a) => a) ?? "—";

    const portsMap = ins.NetworkSettings?.Ports ?? {};
    const ports: string[] = [];
    for (const [cPort, bindings] of Object.entries(portsMap)) {
      if (bindings && bindings.length > 0) {
        for (const b of bindings) ports.push(`${b.HostIp || "0.0.0.0"}:${b.HostPort} → ${cPort}`);
      } else {
        ports.push(`${cPort} (internal)`);
      }
    }
    if (ports.length === 0) ports.push("(none published)");

    const mounts = (ins.Mounts ?? []).map((m) => {
      const src = m.Type === "volume" ? (m.Name ?? "volume") : m.Source;
      return `${src} → ${m.Destination}${m.RW === false ? " ro" : ""}`;
    });
    if (mounts.length === 0) mounts.push("(none)");

    const peers: ContainerPeer[] = [];
    const seen = new Set<string>();
    const addPeer = (name: string, reason: string): void => {
      const n = name.replace(/^\//u, "");
      if (!n || n === selfName || seen.has(n)) return;
      seen.add(n);
      peers.push({ name: n, reason });
    };
    // declared compose dependencies — label value is "svc:condition:restart,svc2:..."
    const dep = ins.Config.Labels["com.docker.compose.depends_on"];
    if (dep) {
      for (const entry of dep.split(",")) {
        const svc = entry.split(":")[0]?.trim();
        if (svc) addPeer(svc, "depends on");
      }
    }
    // shared DEDICATED networks — the honest "can talk to". The compose project's `_default` net
    // connects every service, so sharing it is meaningless noise (it would list the whole stack);
    // only a purpose-built network (a media net, gluetun's netns, the dockos↔proxy link, …) is a
    // real edge. depends_on above covers declared dependencies regardless of network.
    const DEFAULTS = new Set(["bridge", "host", "none"]);
    const project = ins.Config.Labels[COMPOSE_PROJECT];
    const defaultNet = project ? `${project}_default` : "";
    const userNets = netNames.filter((n) => !DEFAULTS.has(n) && n !== defaultNet);
    if (userNets.length > 0) {
      const allNets = await this.engine.listNetworks();
      await Promise.all(
        allNets
          .filter((n) => userNets.includes(n.Name))
          .map(async (n) => {
            const insN = await this.engine.inspectNetwork(n.Id);
            for (const c of Object.values(insN.Containers ?? {})) addPeer(c.Name, `net · ${n.Name}`);
          }),
      );
    }

    // live unit registers from a one-shot stats read (running units only); restarts/oom off inspect
    let stats: ContainerStats | null = null;
    if (ins.State.Running) {
      try {
        stats = await this.engine.containerStats(id);
      } catch {
        stats = null;
      }
    }

    const health = ins.State.Health?.Status ?? (ins.State.Running ? "running" : ins.State.Status);
    return {
      image: ins.Config.Image ?? "—",
      created: ins.Created.slice(0, 19).replace("T", " "),
      restart: ins.HostConfig?.RestartPolicy?.Name || "no",
      health,
      ip,
      ports,
      mounts,
      networks: netNames,
      peers,
      registers: buildRegisters(ins, stats),
    } satisfies ContainerDetail;
  }

  private async actionResult(id: string): Promise<ContainerActionResult> {
    const ins = await this.engine.inspectContainer(id);
    return { id: ins.Id.slice(0, 12), state: inspectState(ins) };
  }

  private stackFor(labels: Record<string, string>): string {
    const explicit = labels[STACK_LABEL];
    if (explicit) return explicit;
    const service = labels[COMPOSE_SERVICE];
    if (this.compose && service) {
      const stack = stackOfService(this.compose, service);
      if (stack) return stack;
    }
    return labels[COMPOSE_PROJECT] ?? "—";
  }

  private toContainer(s: ContainerSummary): Container {
    const state = summaryState(s);
    const live = state === "up" || state === "paused" || state === "unhealthy";
    const snap: UnitStats | undefined = this.stats.snapshot(s.Id);
    const mem = live
      ? `${formatBytes(snap?.memUsed ?? 0)}/${formatBytes(snap?.memLimit ?? 0)}`
      : exitedMem(s.Status);
    const net = live ? `↑${formatCount(snap?.netTx ?? 0)} ↓${formatCount(snap?.netRx ?? 0)}` : "—";
    return {
      id: s.Id.slice(0, 12),
      name: s.Names[0]?.replace(/^\//u, "") ?? s.Id.slice(0, 12),
      stack: this.stackFor(s.Labels),
      state,
      cpu: snap?.cpu ?? 0,
      cpuHistory: live ? padHistory(snap?.cpuHistory ?? []) : zeroes(HISTORY_LEN),
      mem,
      memHistory: live ? padHistory(snap?.memHistory ?? []) : zeroes(HISTORY_LEN),
      net,
      uptime: live ? compactUptime(s.Status) : "—",
    };
  }
}
