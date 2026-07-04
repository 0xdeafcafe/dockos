# Running the DOCK/OS server against real services

The server is plain Node 24 type-stripping — no build step. It talks to three real backends:

- **Docker Engine** over `DOCKER_HOST` (a unix socket locally, the socket proxy in the stack)
- **Prometheus** over `DOCKOS_PROMETHEUS_URL` for deep history (node_exporter + cadvisor)
- an **identity source** selected by `DOCKOS_AUTH` (`forward` = Authelia headers, `oidc` = built-in
  relying party, `dev` = a fabricated local operator)

```sh
pnpm --filter @dockos/server dev     # node --watch, restarts on change
pnpm --filter @dockos/server typecheck
```

Nothing is faked. If Docker is unreachable the fleet methods answer `docker.unreachable`; if
Prometheus is unreachable (or `DOCKOS_PROMETHEUS_URL` is unset) the `metrics.*` methods answer
`prometheus.unreachable`. When node_exporter / cadvisor series are simply absent the history
methods return **empty arrays** (and the host readout returns zeros) — a missing exporter is a
flat chart, not a fault.

## A. Local dev against a local Docker + a port-forwarded Prometheus

Uses your machine's Docker socket and a Prometheus tunnelled from the `thuis` host. No IdP.

```sh
# forward the stack's Prometheus to localhost:9090 (Prometheus is not publicly exposed)
ssh -N -L 9090:localhost:9090 thuis      # or: limactl / your VM's port-forward

DOCKER_HOST=unix:///var/run/docker.sock \
DOCKOS_PROMETHEUS_URL=http://localhost:9090 \
DOCKOS_AUTH=dev \
DOCKOS_METRICS=false \
PORT=8080 \
pnpm --filter @dockos/server dev
```

`DOCKOS_AUTH=dev` mints a local operator so `auth.session` succeeds without an IdP. Point the web
dev server (`pnpm --filter @dockos/web dev`) at `http://localhost:8080` for the RPC surface.

`unix:///var/run/docker.sock` is also the default when `DOCKER_HOST` is unset, so on Linux/macOS
with Docker Desktop you can drop that line entirely.

Quick smoke test:

```sh
curl -s -XPOST localhost:8080/rpc/host.info
curl -s -XPOST localhost:8080/rpc/containers.list
curl -s -XPOST localhost:8080/rpc/metrics.host
curl -s -XPOST localhost:8080/rpc/metrics.hostHistory -d '{"window":"6h"}'
curl -s -XPOST localhost:8080/rpc/metrics.containerHistory -d '{"name":"caddy","window":"1h"}'
```

## B. In the thuis stack (production shape)

The server runs inside compose next to the socket proxy and Prometheus, behind Caddy which does
Authelia forward-auth. No host Docker socket is mounted — it talks to the proxy over tcp.

```sh
DOCKER_HOST=tcp://docker-socket-proxy:2375   # never mount the raw socket
DOCKOS_PROMETHEUS_URL=http://prometheus:9090
DOCKOS_AUTH=forward                          # Caddy injects Remote-User/-Email/-Name/-Groups
DOCKOS_COMPOSE_FILE=/stack/compose.yaml      # profile-aware stacks (optional)
DOCKOS_METRICS=true                          # GET /metrics (prom-client exporter)
# DOCKOS_READ_ONLY / DOCKOS_ALLOW_RESTART|STOP|PAUSE|PROFILES gate the mutating methods
```

In `forward` mode `auth.session` trusts `Remote-User` (+ `Remote-Email`, `Remote-Name`,
`Remote-Groups`) and answers `auth.missing` when they're absent — so only reach it through Caddy.

## C. Built-in OIDC (server is its own relying party)

For deployments where the proxy does not forward-auth. Full PKCE + JWKS verification; the operator
is sealed into an HMAC session cookie by `/auth/callback`.

```sh
DOCKOS_AUTH=oidc
DOCKOS_OIDC_ISSUER=https://auth.thuis.forbes.red
DOCKOS_OIDC_CLIENT_ID=dockos
DOCKOS_OIDC_CLIENT_SECRET=…
DOCKOS_OIDC_REDIRECT_URI=https://dockos.thuis.forbes.red/auth/callback   # optional; else per-origin
DOCKOS_SESSION_SECRET=…            # stable HMAC key (random per boot when unset → cookies drop on restart)
```

Browser flow: `GET /auth/login` → provider → `GET /auth/callback` → session cookie → `GET /auth/logout`.

## Prometheus scrape requirements

`metrics.*` needs these series present in Prometheus (they're standard node_exporter + cadvisor):

- host: `node_cpu_seconds_total`, `node_memory_MemAvailable_bytes`, `node_memory_MemTotal_bytes`,
  `node_filesystem_avail_bytes` / `node_filesystem_size_bytes` (`mountpoint="/"`)
- containers: `container_cpu_usage_seconds_total`, `container_memory_usage_bytes`,
  `machine_memory_bytes` (cadvisor)

## Known gap (not wired to real data)

The SYSTEM view's **image audit** (versions / drift / CVEs) stays on mock in the frontend. Doing it
for real needs a registry-digest client plus a trivy/grype scan — out of scope here, deliberately
not faked on the backend.
