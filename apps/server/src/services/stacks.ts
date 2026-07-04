import { HandledError } from "@dockos/contract";
import type { Stack, StackState, StacksDownResult, StacksUpResult } from "@dockos/contract";
import type { ComposeProfileMap } from "../adapters/compose-file.ts";
import { servicesInStack } from "../adapters/compose-file.ts";
import type { ContainerSummary, DockerEngine } from "../ports/docker.ts";
import { formatBytes } from "../util/format.ts";
import type { StatsHistoryService } from "./stats-history.ts";

const COMPOSE_SERVICE = "com.docker.compose.service";
const COMPOSE_PROJECT = "com.docker.compose.project";

interface StackMembers {
  name: string;
  // declared services with no container yet (only known via the compose file)
  missing: string[];
  containers: ContainerSummary[];
}

function isRunning(c: ContainerSummary): boolean {
  return c.State === "running" || c.State === "paused";
}

// Stacks are compose profiles when the compose file is available (DOCKOS_COMPOSE_FILE),
// otherwise compose projects derived from container labels. up/down drive the *existing*
// containers of a stack through the engine — declared-but-never-created services are skipped
// (the engine API cannot compose-create them).
export class StackService {
  private readonly engine: DockerEngine;
  private readonly stats: StatsHistoryService;
  private readonly compose: ComposeProfileMap | null;

  constructor(engine: DockerEngine, stats: StatsHistoryService, compose: ComposeProfileMap | null) {
    this.engine = engine;
    this.stats = stats;
    this.compose = compose;
  }

  async list(): Promise<Stack[]> {
    const groups = await this.resolveAll();
    return groups.map((g) => this.describe(g));
  }

  async up(name: string): Promise<StacksUpResult> {
    const group = await this.resolve(name);
    const targets = group.containers.filter((c) => !isRunning(c));
    await Promise.all(targets.map((c) => this.engine.startContainer(c.Id)));
    return { name, started: targets.map((c) => nameOf(c)), skipped: group.missing };
  }

  async down(name: string): Promise<StacksDownResult> {
    const group = await this.resolve(name);
    const targets = group.containers.filter((c) => isRunning(c));
    await Promise.all(targets.map((c) => this.engine.stopContainer(c.Id)));
    return { name, stopped: targets.map((c) => nameOf(c)), skipped: group.missing };
  }

  private async resolveAll(): Promise<StackMembers[]> {
    const containers = await this.engine.listContainers(true);
    if (this.compose) {
      return this.compose.stacks.map((name) => this.membersOf(name, containers));
    }
    const byProject = new Map<string, ContainerSummary[]>();
    for (const c of containers) {
      const project = c.Labels[COMPOSE_PROJECT] ?? "(none)";
      const group = byProject.get(project) ?? [];
      group.push(c);
      byProject.set(project, group);
    }
    return [...byProject.entries()].map(([name, members]) => ({
      name,
      missing: [],
      containers: members,
    }));
  }

  private async resolve(name: string): Promise<StackMembers> {
    const groups = await this.resolveAll();
    const group = groups.find((g) => g.name === name);
    if (!group) {
      throw new HandledError("unit.not_found", `no such stack: ${name}`, {
        meta: { known: groups.map((g) => g.name) },
        hint: "stacks.list has the live stack names",
      });
    }
    return group;
  }

  private membersOf(name: string, containers: ContainerSummary[]): StackMembers {
    const compose = this.compose;
    if (!compose) return { name, missing: [], containers: [] };
    const declared = servicesInStack(compose, name);
    const present = new Set<string>();
    const members: ContainerSummary[] = [];
    for (const c of containers) {
      const service = c.Labels[COMPOSE_SERVICE];
      if (service && declared.includes(service)) {
        members.push(c);
        present.add(service);
      }
    }
    return { name, missing: declared.filter((s) => !present.has(s)), containers: members };
  }

  private describe(group: StackMembers): Stack {
    const total = group.containers.length + group.missing.length;
    const running = group.containers.filter((c) => isRunning(c)).length;
    let state: StackState = "partial";
    if (running === 0) state = "down";
    else if (running === total) state = "up";

    let cpu = 0;
    let mem = 0;
    for (const c of group.containers) {
      const snap = this.stats.snapshot(c.Id);
      if (!snap || !isRunning(c)) continue;
      cpu += snap.cpu;
      mem += snap.memUsed;
    }
    return {
      name: group.name,
      state,
      services: `${running}/${total}`,
      cpu: running === 0 ? "—" : `${Math.round(cpu)}%`,
      mem: running === 0 ? "—" : formatBytes(mem),
    };
  }
}

function nameOf(c: ContainerSummary): string {
  return c.Names[0]?.replace(/^\//u, "") ?? c.Id.slice(0, 12);
}
