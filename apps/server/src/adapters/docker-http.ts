import http from "node:http";
import { HandledError } from "@dockos/contract";
import type {
  ArchiveResult,
  ContainerInspect,
  ContainerStats,
  ContainerSummary,
  DockerEngine,
  EngineInfo,
  EngineVersion,
  ImageSummary,
  NetworkInspect,
  NetworkSummary,
  VolumeSummary,
} from "../ports/docker.ts";

// Talks the Docker Engine HTTP API over node:http — no client dependency. Supports both a
// unix socket (local dev default) and tcp (the docker-socket-proxy in the stack), selected by
// DOCKER_HOST: `unix:///var/run/docker.sock` or `tcp://docker-socket-proxy:2375`.

export interface DockerTarget {
  socketPath?: string;
  host?: string;
  port?: number;
  label: string;
}

export function parseDockerHost(raw: string | undefined): DockerTarget {
  const value = raw?.trim();
  if (!value || value.startsWith("unix://")) {
    const socketPath = value ? value.slice("unix://".length) : "/var/run/docker.sock";
    return { socketPath, label: `unix://${socketPath}` };
  }
  const url = new URL(value.replace(/^tcp:\/\//u, "http://"));
  const port = url.port ? Number(url.port) : 2375;
  return { host: url.hostname, port, label: `tcp://${url.hostname}:${port}` };
}

interface EngineResponse {
  status: number;
  buf: Buffer;
}

function query(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `?${qs}` : "";
}

export class DockerHttpEngine implements DockerEngine {
  private readonly target: DockerTarget;

  constructor(target: DockerTarget) {
    this.target = target;
  }

  async listContainers(all: boolean): Promise<ContainerSummary[]> {
    return await this.json(`/containers/json${query({ all: String(all) })}`);
  }

  async inspectContainer(id: string): Promise<ContainerInspect> {
    return await this.json(`/containers/${encodeURIComponent(id)}/json`);
  }

  async containerStats(id: string): Promise<ContainerStats> {
    const qs = query({ stream: "false", "one-shot": "true" });
    return await this.json(`/containers/${encodeURIComponent(id)}/stats${qs}`);
  }

  async containerLogs(id: string, tail: number): Promise<Buffer> {
    const qs = query({ stdout: "true", stderr: "true", timestamps: "true", tail: String(tail) });
    const res = await this.call("GET", `/containers/${encodeURIComponent(id)}/logs${qs}`);
    if (res.status >= 400) throw this.httpError(res);
    return res.buf;
  }

  async restartContainer(id: string): Promise<void> {
    // t=10 → the engine gives SIGTERM 10s to stop before SIGKILL, then starts. A SIGTERM-ignoring
    // unit can eat the full window + start time, so this needs a client timeout well past 10s (the
    // default 15s was tripping restart even though the engine completed it).
    await this.act(`/containers/${encodeURIComponent(id)}/restart${query({ t: "10" })}`, 60_000);
  }

  async killContainer(id: string): Promise<void> {
    await this.act(`/containers/${encodeURIComponent(id)}/kill`);
  }

  async pauseContainer(id: string): Promise<void> {
    await this.act(`/containers/${encodeURIComponent(id)}/pause`);
  }

  async unpauseContainer(id: string): Promise<void> {
    await this.act(`/containers/${encodeURIComponent(id)}/unpause`);
  }

  async startContainer(id: string): Promise<void> {
    await this.act(`/containers/${encodeURIComponent(id)}/start`);
  }

  async stopContainer(id: string): Promise<void> {
    await this.act(`/containers/${encodeURIComponent(id)}/stop${query({ t: "10" })}`, 60_000);
  }

  async listNetworks(): Promise<NetworkSummary[]> {
    return await this.json("/networks");
  }

  async inspectNetwork(id: string): Promise<NetworkInspect> {
    return await this.json(`/networks/${encodeURIComponent(id)}`);
  }

  async listImages(): Promise<ImageSummary[]> {
    return await this.json("/images/json");
  }

  async listVolumes(): Promise<VolumeSummary[]> {
    const res = await this.json<{ Volumes: VolumeSummary[] | null }>("/volumes");
    return res.Volumes ?? [];
  }

  async countVolumes(): Promise<number> {
    const res = await this.json<{ Volumes: unknown[] | null }>("/volumes");
    return res.Volumes?.length ?? 0;
  }

  // GET the container's tar archive of `path`, reading at most `maxBytes` then cutting the stream.
  containerArchive(id: string, path: string, maxBytes: number): Promise<ArchiveResult> {
    const reqPath = `/containers/${encodeURIComponent(id)}/archive?path=${encodeURIComponent(path)}`;
    return new Promise<ArchiveResult>((resolve, reject) => {
      const base: http.RequestOptions = { method: "GET", path: reqPath, headers: { Host: "docker" } };
      const opts: http.RequestOptions =
        this.target.socketPath === undefined
          ? { ...base, host: this.target.host, port: this.target.port }
          : { ...base, socketPath: this.target.socketPath };
      let done = false;
      const finish = (fn: () => void): void => {
        if (done) return;
        done = true;
        fn();
      };
      const req = http.request(opts, (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (status >= 400) {
            chunks.push(chunk); // small JSON error body — collect it all
            return;
          }
          if (truncated) return;
          total += chunk.length;
          if (total > maxBytes) {
            truncated = true;
            const room = chunk.length - (total - maxBytes);
            if (room > 0) chunks.push(chunk.subarray(0, room));
            req.destroy();
            finish(() => resolve({ buf: Buffer.concat(chunks), truncated: true }));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (status >= 400) {
            finish(() => reject(this.httpError({ status, buf: Buffer.concat(chunks) })));
            return;
          }
          finish(() => resolve({ buf: Buffer.concat(chunks), truncated }));
        });
        res.on("error", (err) => finish(() => reject(this.unreachable(err))));
      });
      req.setTimeout(15_000, () => req.destroy(new Error("docker request timed out")));
      req.on("error", (err) => finish(() => reject(this.unreachable(err))));
      req.end();
    });
  }

  async version(): Promise<EngineVersion> {
    return await this.json("/version");
  }

  async info(): Promise<EngineInfo> {
    return await this.json("/info");
  }

  private async json<T>(path: string): Promise<T> {
    const res = await this.call("GET", path);
    if (res.status >= 400) throw this.httpError(res);
    return JSON.parse(res.buf.toString("utf8")) as T;
  }

  // POST actions: 204 is done, 304 means "already in that state" — both count as success.
  private async act(path: string, timeoutMs?: number): Promise<void> {
    const res = await this.call("POST", path, timeoutMs);
    if (res.status >= 400) throw this.httpError(res);
  }

  private httpError(res: EngineResponse): HandledError {
    let message = `docker engine returned ${res.status}`;
    try {
      const parsed = JSON.parse(res.buf.toString("utf8")) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    if (res.status === 404) {
      return new HandledError("unit.not_found", message, {
        hint: "the unit may have been removed — refresh the fleet",
      });
    }
    if (res.status === 409) {
      return new HandledError("unit.conflict", message, {
        hint: "the unit is not in a state that allows this action",
      });
    }
    return new HandledError("docker.error", message, { meta: { status: res.status } });
  }

  private call(method: string, path: string, timeoutMs = 15_000): Promise<EngineResponse> {
    return new Promise<EngineResponse>((resolve, reject) => {
      const base: http.RequestOptions = { method, path, headers: { Host: "docker" } };
      const opts: http.RequestOptions =
        this.target.socketPath === undefined
          ? { ...base, host: this.target.host, port: this.target.port }
          : { ...base, socketPath: this.target.socketPath };
      const req = http.request(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, buf: Buffer.concat(chunks) }));
        res.on("error", (err) => reject(this.unreachable(err)));
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error("docker request timed out")));
      req.on("error", (err) => reject(this.unreachable(err)));
      req.end();
    });
  }

  private unreachable(cause: unknown): HandledError {
    return new HandledError(
      "docker.unreachable",
      `cannot reach the docker engine at ${this.target.label}`,
      {
        hint: "check DOCKER_HOST and that the socket proxy is running",
        meta: { target: this.target.label },
        cause,
      },
    );
  }
}
