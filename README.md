# DOCK/OS

A terminal-desk / CRT web dashboard for the `thuis` Docker stack — live stats from the Docker Engine,
deep history from Prometheus, drive the stack (restart / profiles / logs / exec), and a network map of
what talks to what. lazydocker energy, SUPERHOT vibes.

> **Eventual home: `github.com/0xdeafcafe/dockos`.** For now it lives inside the `thuis` monorepo at
> `Source/0xdeafcafe/docking`; it can be split out to its own repo later with no code changes.

## Layout

- `apps/web` — Vite + React 19 (React Compiler) SPA. The whole UI: CRT scene, boot ROM, every screen.
- `apps/server` — Hono on Node 24 (`--experimental-strip-types`, **no transpile**). Serves the SPA + RPC.
- `packages/contract` — zod schemas shared server↔web (the RPC source of truth).

## Backend shape

RPC: functional, **all-POST**, JSON, zod-validated, at `POST /rpc/<domain>.<name>`. One-way live
streams are **SSE**. Errors are typed `HandledError`s; the kernel serializes handled ones and
logs + masks the rest. Server = langwatch-style app-layer (`ports/ adapters/ services/ util/`, ES
classes, explicit DI).

### The RPC protocol (Phase 1)

Single shape: `POST /rpc/<domain>.<name>` with a JSON body = the method's params (empty body =
`{}`). Every method's params **and** result are zod schemas in `packages/contract`
(`rpcMethods` is the typed map; web derives types via `z.infer`). Responses:

- `200` → `{ ok: true, data: <result> }`
- `4xx/5xx` → `{ ok: false, error: { kind, message, meta, hint?, httpStatus } }`

Error kinds are enumerated in `packages/contract/src/errors.ts` (`validation.failed`,
`auth.missing`, `auth.expired`, `auth.failed`, `unit.not_found`, `unit.conflict`, `forbidden`,
`docker.unreachable`, `docker.error`, `prometheus.unreachable`, `prometheus.error`,
`rpc.unknown_method`, `internal`). Unhandled server errors
never leak stacks — they arrive as kind `internal`. Params never accept free-form strings:
container ids are hex engine ids, stack names are charset-validated, everything else is enum'd.

| method                      | params          | result                                                       |
| --------------------------- | --------------- | ------------------------------------------------------------ |
| `health.ping`               | `{}`            | `{ pong, at }`                                               |
| `auth.session`              | `{}`            | `{ operator }` or `auth.missing` / `auth.expired`            |
| `config.get`                | `{}`            | `{ readOnly, capabilities, ui.density, auth.mode, metrics }` |
| `containers.list`           | `{ stack? }`    | `{ containers[] }` (cpu/mem histories included)              |
| `containers.restart`        | `{ id }`        | `{ id, state }`                                              |
| `containers.kill`           | `{ id }`        | `{ id, state }`                                              |
| `containers.pause`          | `{ id }`        | `{ id, state }` (toggles pause/unpause)                      |
| `containers.logs`           | `{ id, tail? }` | `{ lines[] }`                                                |
| `containers.env`            | `{ id }`        | `{ env[] }` (secret-looking values masked server-side)       |
| `stacks.list`               | `{}`            | `{ stacks[] }` (compose profiles when the file is mounted)   |
| `stacks.up` / `stacks.down` | `{ name }`      | `{ name, started/stopped[], skipped[] }`                     |
| `networks.list`             | `{}`            | `{ networks[] }`                                             |
| `host.info`                 | `{}`            | engine/uptime/counts/cpu/mem/disk                            |
| `metrics.host`              | `{}`            | `{ cpu, mem, memText, disk }` (Prometheus/node_exporter)     |
| `metrics.hostHistory`       | `{ window?, step? }` | `{ cpu[], mem[] }` over a range (query_range)           |
| `metrics.containerHistory`  | `{ id? \| name?, window? }` | `{ cpu[], mem[] }` (cadvisor)                    |

Mutating methods are **gated by server config**: `DOCKOS_READ_ONLY=true` refuses them all
(kind `forbidden`), and each is individually switched (`DOCKOS_ALLOW_RESTART/STOP/PAUSE/PROFILES`).
The web reads the same flags via `config.get`.

### Server config (env)

`DOCKER_HOST` (unix socket default, `tcp://docker-socket-proxy:2375` in the stack) ·
`DOCKOS_AUTH` = `forward` (Authelia headers) | `oidc` (built-in relying party: `/auth/login`,
`/auth/callback`, `/auth/logout`, PKCE + JWKS verification, HMAC session cookie —
`DOCKOS_OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET`, optional `DOCKOS_OIDC_REDIRECT_URI`,
`DOCKOS_SESSION_SECRET`) | `dev` ·
`DOCKOS_PROMETHEUS_URL` (deep history — node_exporter/cadvisor via the `metrics.*` methods;
server-only, unset → `prometheus.unreachable`) ·
`DOCKOS_COMPOSE_FILE` (profile-aware stacks) · `DOCKOS_STATS_INTERVAL_MS` ·
`DOCKOS_READ_ONLY` + `DOCKOS_ALLOW_*` · `DOCKOS_UI_DENSITY` · `DOCKOS_METRICS`
(prometheus at `GET /metrics`) · `DOCKOS_LOG_LEVEL` (pino JSON logs). Full list:
`apps/server/src/config.ts`.

## Toolchain

pnpm workspace · Node 24 type-stripping · Vite · `tsgo` typecheck · **oxlint + oxfmt** (strict, zero-warnings).

## Phases

- **Phase 0** — design-first: the full frontend on mock data, served static behind Caddy
  forward-auth at `https://dockos.thuis.forbes.red`.
- **Phase 1** (current) — the real backend: RPC surface above, Docker engine over the socket
  proxy, server-side cpu/mem history buffers, OIDC/forward auth, pino logs, prometheus metrics.
  Run it: `pnpm --filter @dockos/server dev` (checks: `pnpm --filter @dockos/server typecheck`).
