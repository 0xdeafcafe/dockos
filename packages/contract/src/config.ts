import { z } from "zod";

// The server's operator-facing configuration, surfaced via config.get so the web can adapt:
// hide actions the server refuses (read-only / capability-gated), pick the default density,
// and know how sign-in works. Values come from DOCKOS_* env vars on the server.

export const UiDensity = z.enum(["compact", "comfortable"]);
export type UiDensity = z.infer<typeof UiDensity>;

export const AuthModeName = z.enum(["forward", "oidc", "dev"]);
export type AuthModeName = z.infer<typeof AuthModeName>;

// What this deployment is allowed to do. readOnly=true wins over everything: all mutating
// methods answer kind "forbidden". With readOnly=false, each capability gates its methods:
//   restart  → containers.restart
//   stop     → containers.kill
//   pause    → containers.pause
//   profiles → stacks.up / stacks.down
export const ServerCapabilities = z.object({
  restart: z.boolean(),
  stop: z.boolean(),
  pause: z.boolean(),
  profiles: z.boolean(),
});
export type ServerCapabilities = z.infer<typeof ServerCapabilities>;

export const ServerConfig = z.object({
  readOnly: z.boolean(),
  capabilities: ServerCapabilities,
  ui: z.object({ density: UiDensity }),
  auth: z.object({
    mode: AuthModeName,
    // where to send the browser to sign in (OIDC mode), null when the proxy handles it
    loginUrl: z.string().nullable(),
  }),
  metrics: z.boolean(),
});
export type ServerConfig = z.infer<typeof ServerConfig>;

export const ConfigGetParams = z.object({});
export type ConfigGetParams = z.infer<typeof ConfigGetParams>;

export const ConfigGetResult = ServerConfig;
export type ConfigGetResult = z.infer<typeof ConfigGetResult>;
