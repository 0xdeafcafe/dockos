import type { ContainerStats, DockerEngine } from "../ports/docker.ts";
import { clampPct } from "../util/format.ts";
import type { Logger } from "../util/logger.ts";

// Polls one-shot stats for every running unit and keeps short ring buffers server-side, so
// containers.list can ship sparkline-ready cpu/mem histories on first paint. One-shot stats
// skip the engine's built-in 1s double sample; cpu% comes from the delta between our own polls.

export const HISTORY_LEN = 48;

export interface UnitStats {
  cpu: number;
  cpuHistory: number[];
  memUsed: number;
  memLimit: number;
  memPct: number;
  memHistory: number[];
  netRx: number;
  netTx: number;
}

interface CpuSample {
  cpuTotal: number;
  systemTotal: number;
}

interface UnitBuffer {
  cpuHistory: number[];
  memHistory: number[];
  latest: UnitStats;
  prev: CpuSample | null;
}

function memUsage(stats: ContainerStats): { used: number; limit: number } {
  const raw = stats.memory_stats.usage ?? 0;
  const cache = stats.memory_stats.stats?.inactive_file ?? stats.memory_stats.stats?.cache ?? 0;
  return { used: Math.max(0, raw - cache), limit: stats.memory_stats.limit ?? 0 };
}

function netTotals(stats: ContainerStats): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const iface of Object.values(stats.networks ?? {})) {
    rx += iface.rx_bytes;
    tx += iface.tx_bytes;
  }
  return { rx, tx };
}

export class StatsHistoryService {
  private readonly engine: DockerEngine;
  private readonly log: Logger;
  private readonly buffers = new Map<string, UnitBuffer>();
  private timer: NodeJS.Timeout | null = null;
  private warned = false;

  constructor(engine: DockerEngine, log: Logger) {
    this.engine = engine;
    this.log = log;
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    const tick = (): void => {
      this.pollOnce().catch((err: unknown) => {
        if (!this.warned) {
          this.log.warn({ err }, "stats poll failed");
          this.warned = true;
        }
      });
    };
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(id: string): UnitStats | undefined {
    return this.buffers.get(id)?.latest;
  }

  async pollOnce(): Promise<void> {
    const containers = await this.engine.listContainers(true);
    this.warned = false;
    const alive = new Set(containers.map((c) => c.Id));
    for (const id of this.buffers.keys()) {
      if (!alive.has(id)) this.buffers.delete(id);
    }
    const running = containers.filter((c) => c.State === "running" || c.State === "paused");
    await Promise.allSettled(
      running.map(async (c) => {
        const stats = await this.engine.containerStats(c.Id);
        this.ingest(c.Id, stats);
      }),
    );
  }

  private ingest(id: string, stats: ContainerStats): void {
    const buffer = this.buffers.get(id) ?? {
      cpuHistory: [],
      memHistory: [],
      latest: {
        cpu: 0,
        cpuHistory: [],
        memUsed: 0,
        memLimit: 0,
        memPct: 0,
        memHistory: [],
        netRx: 0,
        netTx: 0,
      },
      prev: null,
    };

    const sample: CpuSample = {
      cpuTotal: stats.cpu_stats.cpu_usage.total_usage,
      systemTotal: stats.cpu_stats.system_cpu_usage ?? 0,
    };
    let cpu = 0;
    if (buffer.prev) {
      const cpuDelta = sample.cpuTotal - buffer.prev.cpuTotal;
      const systemDelta = sample.systemTotal - buffer.prev.systemTotal;
      if (cpuDelta > 0 && systemDelta > 0) {
        cpu = clampPct((cpuDelta / systemDelta) * (stats.cpu_stats.online_cpus ?? 1) * 100);
      }
    }
    buffer.prev = sample;

    const { used, limit } = memUsage(stats);
    const memPct = clampPct(limit > 0 ? (used / limit) * 100 : 0);
    const { rx, tx } = netTotals(stats);

    buffer.cpuHistory.push(Math.round(cpu));
    buffer.memHistory.push(Math.round(memPct));
    if (buffer.cpuHistory.length > HISTORY_LEN) buffer.cpuHistory.shift();
    if (buffer.memHistory.length > HISTORY_LEN) buffer.memHistory.shift();

    buffer.latest = {
      cpu: Math.round(cpu * 10) / 10,
      cpuHistory: buffer.cpuHistory,
      memUsed: used,
      memLimit: limit,
      memPct,
      memHistory: buffer.memHistory,
      netRx: rx,
      netTx: tx,
    };
    this.buffers.set(id, buffer);
  }
}
