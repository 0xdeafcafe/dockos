import type {
  Container,
  ContainerActionResult,
  ContainerState,
  ContainersListParams,
  EnvVar,
  LogLevel,
  LogLine,
} from "@dockos/contract";
import type { ComposeProfileMap } from "../adapters/compose-file.ts";
import { stackOfService } from "../adapters/compose-file.ts";
import type { ContainerInspect, ContainerSummary, DockerEngine } from "../ports/docker.ts";
import { compactUptime, formatBytes, formatCount } from "../util/format.ts";
import type { StatsHistoryService, UnitStats } from "./stats-history.ts";
import { HISTORY_LEN } from "./stats-history.ts";

const COMPOSE_SERVICE = "com.docker.compose.service";
const COMPOSE_PROJECT = "com.docker.compose.project";
const STACK_LABEL = "dockos.stack";

const SECRET_KEY = /(?:secret|token|password|passwd|api[_-]?key|apikey|private|credential|auth)/iu;
const MASK = "••••••••";

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

  constructor(engine: DockerEngine, stats: StatsHistoryService, compose: ComposeProfileMap | null) {
    this.engine = engine;
    this.stats = stats;
    this.compose = compose;
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

  // Secret-looking keys are masked server-side; the real value never leaves the server.
  async env(id: string): Promise<EnvVar[]> {
    const ins = await this.engine.inspectContainer(id);
    return (ins.Config.Env ?? []).map((entry) => {
      const split = entry.indexOf("=");
      const key = split >= 0 ? entry.slice(0, split) : entry;
      const value = split >= 0 ? entry.slice(split + 1) : "";
      const secret = SECRET_KEY.test(key);
      return { key, value: secret ? MASK : value, secret };
    });
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
