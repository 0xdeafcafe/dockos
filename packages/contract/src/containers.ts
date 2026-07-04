import { z } from "zod";

// Container shapes mirror what the fleet UI renders: live gauge values plus short history
// buffers (the server keeps a ring buffer per unit so sparklines are populated on first paint).

export const ContainerState = z.enum(["up", "paused", "exited", "unhealthy"]);
export type ContainerState = z.infer<typeof ContainerState>;

// Params never accept arbitrary strings: unit ids are the short/long hex ids the server itself
// handed out via containers.list, and stack names are validated against the same charset the
// server derives from compose. Anything else fails validation before reaching the engine.
export const ContainerId = z.string().regex(/^[0-9a-f]{12,64}$/u, "expected a container id");
export const StackName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9()._-]+$/u, "expected a stack name");

export const Container = z.object({
  id: z.string(),
  name: z.string(),
  stack: z.string(),
  state: ContainerState,
  cpu: z.number(),
  cpuHistory: z.array(z.number()),
  mem: z.string(),
  memHistory: z.array(z.number()),
  net: z.string(),
  uptime: z.string(),
});
export type Container = z.infer<typeof Container>;

export const ContainersListParams = z.object({
  stack: StackName.optional(),
});
export type ContainersListParams = z.infer<typeof ContainersListParams>;

export const ContainersListResult = z.object({
  containers: z.array(Container),
});
export type ContainersListResult = z.infer<typeof ContainersListResult>;

// restart / kill / pause all address one unit by engine id (any unambiguous prefix works, as
// with the Docker CLI). pause is a toggle: paused units get unpaused.
export const ContainerActionParams = z.object({
  id: ContainerId,
});
export type ContainerActionParams = z.infer<typeof ContainerActionParams>;

export const ContainerActionResult = z.object({
  id: z.string(),
  state: ContainerState,
});
export type ContainerActionResult = z.infer<typeof ContainerActionResult>;

export const LogLevel = z.enum(["info", "warn", "error", "debug"]);
export type LogLevel = z.infer<typeof LogLevel>;

export const LogLine = z.object({
  id: z.number(),
  time: z.string(),
  level: LogLevel,
  source: z.string(),
  msg: z.string(),
});
export type LogLine = z.infer<typeof LogLine>;

export const ContainersLogsParams = z.object({
  id: ContainerId,
  tail: z.number().int().min(1).max(5000).default(200),
});
export type ContainersLogsParams = z.infer<typeof ContainersLogsParams>;

export const ContainersLogsResult = z.object({
  lines: z.array(LogLine),
});
export type ContainersLogsResult = z.infer<typeof ContainersLogsResult>;

// Env vars are redacted server-side: keys that look secret arrive with secret=true and a masked
// value. The real value never crosses the wire.
export const EnvVar = z.object({
  key: z.string(),
  value: z.string(),
  secret: z.boolean(),
});
export type EnvVar = z.infer<typeof EnvVar>;

export const ContainersEnvParams = z.object({
  id: ContainerId,
});
export type ContainersEnvParams = z.infer<typeof ContainersEnvParams>;

export const ContainersEnvResult = z.object({
  env: z.array(EnvVar),
});
export type ContainersEnvResult = z.infer<typeof ContainersEnvResult>;

// A container this one is linked to: reachable on a shared user-defined network, or a declared
// compose dependency (from the com.docker.compose.depends_on label). `reason` explains the edge.
export const ContainerPeer = z.object({
  name: z.string(),
  reason: z.string(),
});
export type ContainerPeer = z.infer<typeof ContainerPeer>;

// The container detail panel — real inspect data plus computed peers.
export const ContainerDetail = z.object({
  image: z.string(),
  created: z.string(),
  restart: z.string(),
  health: z.string(),
  ip: z.string(),
  ports: z.array(z.string()),
  mounts: z.array(z.string()),
  networks: z.array(z.string()),
  peers: z.array(ContainerPeer),
  // live unit registers (pids/net/blk/throttle from stats, restarts/oom from inspect); "—" when
  // the unit is stopped and has no live stats
  registers: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type ContainerDetail = z.infer<typeof ContainerDetail>;

export const ContainersInspectParams = z.object({ id: ContainerId });
export type ContainersInspectParams = z.infer<typeof ContainersInspectParams>;

export const ContainersInspectResult = ContainerDetail;
export type ContainersInspectResult = z.infer<typeof ContainersInspectResult>;

// Read-only filesystem browse via the engine archive API (docker cp out) — NO exec involved.
export const FsEntry = z.object({
  name: z.string(),
  type: z.enum(["dir", "file", "link"]),
  size: z.number(),
});
export type FsEntry = z.infer<typeof FsEntry>;

export const ContainersFilesParams = z.object({ id: ContainerId, path: z.string().default("/") });
export type ContainersFilesParams = z.infer<typeof ContainersFilesParams>;

export const ContainersFilesResult = z.object({
  path: z.string(),
  entries: z.array(FsEntry),
  truncated: z.boolean(),
});
export type ContainersFilesResult = z.infer<typeof ContainersFilesResult>;

export const ContainersFileParams = z.object({ id: ContainerId, path: z.string() });
export type ContainersFileParams = z.infer<typeof ContainersFileParams>;

export const ContainersFileResult = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(),
  binary: z.boolean(),
});
export type ContainersFileResult = z.infer<typeof ContainersFileResult>;

// The container's own service definition, pulled verbatim from the compose file it was created from
// (via the com.docker.compose.service label). `service` is null / `yaml` empty for non-compose units.
export const ContainersComposeParams = z.object({ id: ContainerId });
export type ContainersComposeParams = z.infer<typeof ContainersComposeParams>;

export const ContainersComposeResult = z.object({
  service: z.string().nullable(),
  yaml: z.string(),
});
export type ContainersComposeResult = z.infer<typeof ContainersComposeResult>;
