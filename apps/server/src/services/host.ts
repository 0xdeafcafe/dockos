import { statfs } from "node:fs/promises";
import type { HostInfo } from "@dockos/contract";
import type { DockerEngine } from "../ports/docker.ts";
import { clampPct, formatBytes, formatDuration } from "../util/format.ts";
import type { StatsHistoryService } from "./stats-history.ts";

export class HostService {
  private readonly engine: DockerEngine;
  private readonly stats: StatsHistoryService;

  constructor(engine: DockerEngine, stats: StatsHistoryService) {
    this.engine = engine;
    this.stats = stats;
  }

  async info(): Promise<HostInfo> {
    const [version, info, networks, volumes, containers, disk] = await Promise.all([
      this.engine.version(),
      this.engine.info(),
      this.engine.listNetworks(),
      this.engine.countVolumes(),
      this.engine.listContainers(true),
      diskUsedPct(),
    ]);

    let cpuSum = 0;
    let memUsed = 0;
    let oldestCreated = Number.POSITIVE_INFINITY;
    for (const c of containers) {
      if (c.State !== "running" && c.State !== "paused") continue;
      const snap = this.stats.snapshot(c.Id);
      cpuSum += snap?.cpu ?? 0;
      memUsed += snap?.memUsed ?? 0;
      if (c.Created < oldestCreated) oldestCreated = c.Created;
    }

    // No host boot time on the engine API — the longest-lived unit is the closest honest proxy.
    const uptime = Number.isFinite(oldestCreated)
      ? formatDuration(Date.now() - oldestCreated * 1000)
      : "—";

    return {
      engine: version.Version,
      uptime,
      running: info.ContainersRunning,
      total: info.Containers,
      images: info.Images,
      volumes,
      networks: networks.length,
      cpu: Math.round(clampPct(cpuSum / Math.max(1, info.NCPU))),
      memText: `${formatBytes(memUsed)}/${formatBytes(info.MemTotal)}`,
      disk,
    };
  }
}

async function diskUsedPct(): Promise<number> {
  try {
    const fs = await statfs("/");
    if (fs.blocks === 0) return 0;
    return Math.round(((fs.blocks - fs.bfree) / fs.blocks) * 100);
  } catch {
    return 0;
  }
}
