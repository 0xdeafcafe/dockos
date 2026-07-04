// The engine port: the minimal slice of the Docker Engine HTTP API the services need.
// Shapes use the engine's own field names (PascalCase / snake_case) so the adapter stays a
// dumb pipe; services translate to contract shapes.

export interface ContainerSummary {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Labels: Record<string, string>;
}

export interface ContainerInspect {
  Id: string;
  Name: string;
  Created: string;
  State: {
    Status: string;
    Running: boolean;
    Paused: boolean;
    StartedAt: string;
    ExitCode: number;
    Health?: { Status: string };
  };
  Config: {
    Env: string[] | null;
    Tty: boolean;
    Labels: Record<string, string>;
  };
}

export interface ContainerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  memory_stats: {
    usage?: number;
    limit?: number;
    stats?: Record<string, number>;
  };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}

export interface NetworkSummary {
  Id: string;
  Name: string;
  Driver: string;
  Scope: string;
  Internal: boolean;
}

export interface NetworkInspect extends NetworkSummary {
  Containers: Record<string, { Name: string }> | null;
}

export interface EngineVersion {
  Version: string;
}

export interface EngineInfo {
  Containers: number;
  ContainersRunning: number;
  Images: number;
  NCPU: number;
  MemTotal: number;
}

export interface DockerEngine {
  listContainers(all: boolean): Promise<ContainerSummary[]>;
  inspectContainer(id: string): Promise<ContainerInspect>;
  containerStats(id: string): Promise<ContainerStats>;
  containerLogs(id: string, tail: number): Promise<Buffer>;
  restartContainer(id: string): Promise<void>;
  killContainer(id: string): Promise<void>;
  pauseContainer(id: string): Promise<void>;
  unpauseContainer(id: string): Promise<void>;
  startContainer(id: string): Promise<void>;
  stopContainer(id: string): Promise<void>;
  listNetworks(): Promise<NetworkSummary[]>;
  inspectNetwork(id: string): Promise<NetworkInspect>;
  countVolumes(): Promise<number>;
  version(): Promise<EngineVersion>;
  info(): Promise<EngineInfo>;
}
