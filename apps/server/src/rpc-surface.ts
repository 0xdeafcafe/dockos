import { HandledError } from "@dockos/contract";
import { clientConfig } from "./config.ts";
import { RpcKernel } from "./kernel/rpc.ts";
import type { RpcContext, RpcHandler } from "./kernel/rpc.ts";
import type { App } from "./wiring.ts";
import type { MetricsQueryService } from "./services/metrics-query.ts";
import type { MethodName, MethodParams, MethodResult } from "@dockos/contract";

// Registers every contract method against the services, with mutation gating: read-only mode
// refuses all mutating methods, and each one is additionally switched by its capability
// (DOCKOS_ALLOW_*). The web reads the same flags via config.get and hides what is refused.

type Capability = keyof App["settings"]["capabilities"];

function requireMetrics(service: MetricsQueryService | null): MetricsQueryService {
  if (!service) {
    throw new HandledError("prometheus.unreachable", "metric history is not configured", {
      hint: "set DOCKOS_PROMETHEUS_URL on the server to enable the metrics.* methods",
    });
  }
  return service;
}

export function buildRpcSurface(app: App): RpcKernel {
  const kernel = new RpcKernel(app.log, app.metrics);
  const { settings } = app;

  function gated<M extends MethodName>(
    capability: Capability,
    handler: RpcHandler<M>,
  ): RpcHandler<M> {
    return (
      params: MethodParams<M>,
      ctx: RpcContext,
    ): MethodResult<M> | Promise<MethodResult<M>> => {
      if (settings.readOnly) {
        throw new HandledError("forbidden", "this deployment is read-only", {
          meta: { capability },
          hint: "unset DOCKOS_READ_ONLY on the server to allow actions",
        });
      }
      if (!settings.capabilities[capability]) {
        throw new HandledError("forbidden", `the ${capability} capability is disabled`, {
          meta: { capability },
          hint: `set DOCKOS_ALLOW_${capability.toUpperCase()}=true on the server`,
        });
      }
      return handler(params, ctx);
    };
  }

  kernel.register("health.ping", () => ({ pong: true, at: Date.now() }));
  kernel.register("auth.session", (_params, ctx) => app.auth.session(ctx.header));
  kernel.register("auth.signout", () => app.auth.signout());
  kernel.register("config.get", () => clientConfig(settings));

  kernel.register("containers.list", async (params) => ({
    containers: await app.containers.list(params),
  }));
  kernel.register(
    "containers.restart",
    gated("restart", async ({ id }) => await app.containers.restart(id)),
  );
  kernel.register(
    "containers.kill",
    gated("stop", async ({ id }) => await app.containers.kill(id)),
  );
  kernel.register(
    "containers.pause",
    gated("pause", async ({ id }) => await app.containers.pause(id)),
  );
  kernel.register("containers.logs", async ({ id, tail }) => ({
    lines: await app.containers.logs(id, tail),
  }));
  kernel.register("containers.env", async ({ id }) => ({ env: await app.containers.env(id) }));

  kernel.register("stacks.list", async () => ({ stacks: await app.stacks.list() }));
  kernel.register(
    "stacks.up",
    gated("profiles", async ({ name }) => await app.stacks.up(name)),
  );
  kernel.register(
    "stacks.down",
    gated("profiles", async ({ name }) => await app.stacks.down(name)),
  );

  kernel.register("networks.list", async () => ({ networks: await app.networks.list() }));
  kernel.register("host.info", async () => await app.host.info());

  // Deep history from Prometheus. Unconfigured (no DOCKOS_PROMETHEUS_URL) → prometheus.unreachable,
  // the same kind the adapter raises when the server itself is down, so the web branches once.
  kernel.register("metrics.host", async () => await requireMetrics(app.metricsQuery).host());
  kernel.register(
    "metrics.hostHistory",
    async (params) => await requireMetrics(app.metricsQuery).hostHistory(params),
  );
  kernel.register(
    "metrics.containerHistory",
    async (params) => await requireMetrics(app.metricsQuery).containerHistory(params),
  );

  return kernel;
}
