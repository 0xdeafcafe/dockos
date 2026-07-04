import type { Network } from "@dockos/contract";
import type { DockerEngine } from "../ports/docker.ts";

export class NetworkService {
  private readonly engine: DockerEngine;

  constructor(engine: DockerEngine) {
    this.engine = engine;
  }

  async list(): Promise<Network[]> {
    const summaries = await this.engine.listNetworks();
    const networks = await Promise.all(
      summaries.map(async (s) => {
        const ins = await this.engine.inspectNetwork(s.Id);
        const containers = Object.values(ins.Containers ?? {})
          .map((c) => c.Name)
          .toSorted();
        return {
          id: s.Id.slice(0, 12),
          name: s.Name,
          driver: s.Driver,
          scope: s.Scope,
          internal: s.Internal,
          containers,
        };
      }),
    );
    return networks.toSorted((a, b) => a.name.localeCompare(b.name));
  }
}
