import { randomBytes } from "node:crypto";
import type { ServerConfig, UiDensity } from "@dockos/contract";
import { loadOidcConfig } from "./adapters/oidc.ts";
import type { OidcConfig } from "./adapters/oidc.ts";
import { resolveAuthMode } from "./services/auth.ts";
import type { AuthMode } from "./services/auth.ts";

// All server tunables in one typed place, read once at boot from DOCKOS_* env vars.
// The client-relevant slice is served via the config.get RPC method (see clientConfig).
//
//   DOCKOS_AUTH                forward | oidc | dev (default: oidc if DOCKOS_OIDC_* set,
//                              else forward in production, else dev)
//   DOCKOS_OIDC_ISSUER         e.g. https://auth.thuis.forbes.red
//   DOCKOS_OIDC_CLIENT_ID / DOCKOS_OIDC_CLIENT_SECRET / DOCKOS_OIDC_REDIRECT_URI (optional)
//   DOCKOS_SESSION_SECRET      HMAC key for session cookies (random per boot when unset)
//   DOCKOS_READ_ONLY           true → every mutating method answers kind "forbidden"
//   DOCKOS_ALLOW_RESTART       default true  → containers.restart
//   DOCKOS_ALLOW_STOP          default true  → containers.kill
//   DOCKOS_ALLOW_PAUSE         default true  → containers.pause
//   DOCKOS_ALLOW_PROFILES      default true  → stacks.up / stacks.down
//   DOCKOS_UI_DENSITY          compact | comfortable (default compact)
//   DOCKOS_METRICS             default true → GET /metrics (prometheus text format)
//   DOCKOS_LOG_LEVEL           pino level (fallback LOG_LEVEL, default info)
//   DOCKOS_COMPOSE_FILE        compose.yaml path for profile-aware stacks (optional)
//   DOCKOS_STATS_INTERVAL_MS   stats poll cadence (default 2000, min 500)
//   DOCKOS_PROMETHEUS_URL      Prometheus base URL for deep history (e.g.
//                              http://prometheus:9090). Server-only, never sent to the client.
//                              Unset → the metrics.* RPC methods answer prometheus.unreachable.
//   DOCKER_HOST                unix:///var/run/docker.sock | tcp://docker-socket-proxy:2375
//   PORT                       default 8080

export interface ServerSettings {
  port: number;
  dockerHost: string | undefined;
  composeFile: string | undefined;
  prometheusUrl: string | undefined;
  statsIntervalMs: number;
  logLevel: string;
  metricsEnabled: boolean;
  readOnly: boolean;
  capabilities: {
    restart: boolean;
    stop: boolean;
    pause: boolean;
    profiles: boolean;
  };
  density: UiDensity;
  authMode: AuthMode;
  sessionSecret: string;
  oidc: OidcConfig | null;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function parseDensity(raw: string | undefined): UiDensity {
  return raw === "comfortable" ? "comfortable" : "compact";
}

function parseInterval(raw: string | undefined): number {
  const n = Number(raw ?? 2000);
  return Number.isFinite(n) && n >= 500 ? n : 2000;
}

export function loadSettings(env: NodeJS.ProcessEnv): ServerSettings {
  const oidc = loadOidcConfig(env);
  return {
    port: Number(env.PORT ?? 8080),
    dockerHost: env.DOCKER_HOST,
    composeFile: env.DOCKOS_COMPOSE_FILE,
    prometheusUrl: env.DOCKOS_PROMETHEUS_URL?.trim() || undefined,
    statsIntervalMs: parseInterval(env.DOCKOS_STATS_INTERVAL_MS),
    logLevel: env.DOCKOS_LOG_LEVEL ?? env.LOG_LEVEL ?? "info",
    metricsEnabled: parseBool(env.DOCKOS_METRICS, true),
    readOnly: parseBool(env.DOCKOS_READ_ONLY, false),
    capabilities: {
      restart: parseBool(env.DOCKOS_ALLOW_RESTART, true),
      stop: parseBool(env.DOCKOS_ALLOW_STOP, true),
      pause: parseBool(env.DOCKOS_ALLOW_PAUSE, true),
      profiles: parseBool(env.DOCKOS_ALLOW_PROFILES, true),
    },
    density: parseDensity(env.DOCKOS_UI_DENSITY),
    authMode: resolveAuthMode(env, oidc !== null),
    sessionSecret: env.DOCKOS_SESSION_SECRET?.trim() || randomBytes(32).toString("hex"),
    oidc,
  };
}

// The slice the web is allowed to see (never secrets) — the config.get result.
export function clientConfig(settings: ServerSettings): ServerConfig {
  return {
    readOnly: settings.readOnly,
    capabilities: { ...settings.capabilities },
    ui: { density: settings.density },
    auth: {
      mode: settings.authMode,
      loginUrl: settings.authMode === "oidc" ? "/auth/login" : null,
    },
    metrics: settings.metricsEnabled,
  };
}
