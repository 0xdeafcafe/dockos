import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { HandledError } from "@dockos/contract";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { errorResponse } from "./kernel/rpc.ts";
import { buildRpcSurface } from "./rpc-surface.ts";
import { buildApp } from "./wiring.ts";
import type { App } from "./wiring.ts";

// Phase 1: the real backend. All-POST JSON RPC at /rpc/<domain>.<name>, zod-validated against
// packages/contract, HandledError envelopes, Docker engine via DOCKER_HOST (socket proxy in
// the stack, local unix socket in dev), OIDC or forward-auth identity, pino logs, prometheus
// metrics at /metrics. Protocol doc: packages/contract/src/rpc.ts. Config: src/config.ts.

const WEB_ROOT = "./apps/web/dist";

const app = buildApp(process.env);
const kernel = buildRpcSurface(app);
const hono = new Hono();

// Anything a route did not catch: log it, never leak internals to the client.
hono.onError((err, c) => {
  app.log.error({ err, path: c.req.path }, "unhandled http error");
  return c.text("internal error", 500);
});

hono.get("/healthz", (c) => c.json({ ok: true, service: "docking", phase: 1 }));

hono.post("/rpc/:method", async (c) => {
  let params: unknown;
  try {
    const text = await c.req.text();
    params = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    const res = errorResponse(
      new HandledError("validation.failed", "request body is not valid JSON"),
    );
    return c.json(res.body, res.status as ContentfulStatusCode);
  }
  const res = await kernel.dispatch(c.req.param("method"), params, {
    header: (name) => c.req.header(name),
  });
  return c.json(res.body, res.status as ContentfulStatusCode);
});

function requestOrigin(c: Context): string {
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "localhost";
  return `${proto}://${host}`;
}

// Browser-facing OIDC routes (GET redirects — deliberately outside the POST-only RPC surface).
function registerAuthRoutes(oidc: NonNullable<App["oidcAuth"]>): void {
  hono.get("/auth/login", async (c) => {
    try {
      const { redirectUrl, cookies } = await oidc.beginLogin(requestOrigin(c));
      for (const cookie of cookies) c.header("Set-Cookie", cookie, { append: true });
      return c.redirect(redirectUrl);
    } catch (err) {
      const message = err instanceof HandledError ? err.message : "could not start sign-in";
      if (!(err instanceof HandledError)) app.log.error({ err }, "oidc login failed");
      return c.text(`sign-in unavailable: ${message}`, 502);
    }
  });
  hono.get("/auth/callback", async (c) => {
    try {
      const { cookies } = await oidc.completeLogin(new URL(c.req.url), c.req.header("cookie"));
      for (const cookie of cookies) c.header("Set-Cookie", cookie, { append: true });
      return c.redirect("/");
    } catch (err) {
      const message = err instanceof HandledError ? err.message : "sign-in failed";
      if (!(err instanceof HandledError)) app.log.error({ err }, "oidc callback failed");
      return c.text(`sign-in failed: ${message}\n\nstart again at /auth/login`, 401);
    }
  });
  // Server-side sign-out: clear the docking session cookie, then bounce the browser through the
  // provider's end-session endpoint (dropping Authelia's SSO session too) and back to the app. The
  // auth.signout RPC hands the web this URL; it can't set cookies from a JSON response, so the
  // actual clearing happens here on the GET.
  hono.get("/auth/logout", async (c) => {
    const { cookies, redirectUrl } = await oidc.signout();
    for (const cookie of cookies) c.header("Set-Cookie", cookie, { append: true });
    return c.redirect(redirectUrl ?? "/");
  });
}
if (app.oidcAuth) registerAuthRoutes(app.oidcAuth);

if (app.metrics) {
  const metrics = app.metrics;
  hono.get("/metrics", async (c) => {
    c.header("Content-Type", metrics.contentType());
    return c.body(await metrics.render());
  });
}

// Static SPA: hashed assets first, then index.html for every other path (client-routed).
hono.use("/assets/*", serveStatic({ root: WEB_ROOT }));
hono.use("/favicon.svg", serveStatic({ path: `${WEB_ROOT}/favicon.svg` }));
hono.get("*", serveStatic({ path: `${WEB_ROOT}/index.html` }));

app.stats.start(app.settings.statsIntervalMs);

serve({ fetch: hono.fetch, port: app.settings.port }, (info) => {
  app.log.info(
    {
      port: info.port,
      engine: app.engineLabel,
      auth: app.settings.authMode,
      readOnly: app.settings.readOnly,
      metrics: app.settings.metricsEnabled,
    },
    "docking listening",
  );
});
