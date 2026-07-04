# DOCK/OS

A CRT terminal for a Docker Compose homelab. SUPERHOT's piOS crossed with Alien's MU-TH-UR, a bent glass tube you actually run your stack from.

Live demo (mock data, no backend): **[dockos.forbes.red](https://dockos.forbes.red)** - operator `guest`, key `overwatch`.

## What it does

- **Runs the stack.** Containers, stacks, images, volumes, networks, host vitals, live off the Docker Engine (through a scoped socket-proxy) and Prometheus history. Restart, stop, pull, browse a container's files, read the compose it was built from.
- **Is a real tube.** GPU barrel warp via HTML-in-Canvas, scanlines, phosphor bloom, HDR where the display has it. Falls back to an SVG filter, then to flat glass.
- **Pure TUI.** Unicode box-drawing, one font, all caps. No borders, no radius, no shadows, the structure is glyphs. Keyboard-first, every action on a visible bar.
- **Sealed.** OIDC in front, a boot-ROM cinematic behind it.

## Shape

- `apps/web` - React 19 + Vite SPA. The whole UI: CRT scene, boot ROM, every deck.
- `apps/server` - Hono on Node, no transpile. Serves the SPA and an all-POST JSON RPC.
- `packages/contract` - zod schemas shared both ways, the RPC source of truth.

## Run

- Dev UI on mock data: `cd apps/web && VITE_USE_MOCK=true pnpm dev`.
- Real backend: the server reads `DOCKER_HOST`, `DOCKOS_PROMETHEUS_URL` and the auth env, see `apps/server/src/config.ts`.
- Static demo build (mock, self-contained): `VITE_DEMO=true pnpm --filter web build`.
