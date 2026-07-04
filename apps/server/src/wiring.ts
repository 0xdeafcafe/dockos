import { loadComposeProfiles } from "./adapters/compose-file.ts";
import { DockerHttpEngine, parseDockerHost } from "./adapters/docker-http.ts";
import { OidcClient } from "./adapters/oidc.ts";
import { loadSettings } from "./config.ts";
import type { ServerSettings } from "./config.ts";
import { AuthService } from "./services/auth.ts";
import { ContainerService } from "./services/containers.ts";
import { HostService } from "./services/host.ts";
import { MetricsService } from "./services/metrics.ts";
import { MetricsQueryService } from "./services/metrics-query.ts";
import { NetworkService } from "./services/networks.ts";
import { OidcAuthService } from "./services/oidc-auth.ts";
import { StackService } from "./services/stacks.ts";
import { StatsHistoryService } from "./services/stats-history.ts";
import { createLogger } from "./util/logger.ts";
import type { Logger } from "./util/logger.ts";

// Composition root: adapters → services. Everything is constructed once, explicitly — no
// containers, no magic. main.ts glues this bundle to the HTTP surface.

export interface App {
  settings: ServerSettings;
  log: Logger;
  engineLabel: string;
  stats: StatsHistoryService;
  containers: ContainerService;
  stacks: StackService;
  networks: NetworkService;
  host: HostService;
  auth: AuthService;
  oidcAuth: OidcAuthService | null;
  metrics: MetricsService | null;
  metricsQuery: MetricsQueryService | null;
}

export function buildApp(env: NodeJS.ProcessEnv): App {
  const settings = loadSettings(env);
  const log = createLogger({ LOG_LEVEL: settings.logLevel });

  const target = parseDockerHost(settings.dockerHost);
  const engine = new DockerHttpEngine(target);
  const compose = loadComposeProfiles(settings.composeFile, log);
  const stats = new StatsHistoryService(engine, log);

  const oidcAuth = settings.oidc
    ? new OidcAuthService(new OidcClient(settings.oidc), settings.oidc, settings.sessionSecret, log)
    : null;

  const metricsQuery = settings.prometheusUrl
    ? MetricsQueryService.fromUrl(settings.prometheusUrl)
    : null;

  return {
    settings,
    log,
    engineLabel: target.label,
    stats,
    containers: new ContainerService(engine, stats, compose),
    stacks: new StackService(engine, stats, compose),
    networks: new NetworkService(engine),
    host: new HostService(engine, stats),
    auth: new AuthService(settings.authMode, oidcAuth),
    oidcAuth,
    metrics: settings.metricsEnabled ? new MetricsService() : null,
    metricsQuery,
  };
}
