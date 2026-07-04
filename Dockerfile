# syntax=docker/dockerfile:1
# Multi-stage: build the web SPA, then run the Hono server directly from TS via Node type-stripping.
# Host needs nothing but Docker — the whole toolchain lives in the build stage.

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
# Install deps first (cache layer) from the manifests only.
COPY pnpm-workspace.yaml package.json .npmrc ./
COPY packages/contract/package.json packages/contract/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --no-frozen-lockfile
# Then the sources + build the SPA. The production SPA talks to its OWN server same-origin, so the
# mock is OFF (VITE_USE_MOCK=false) and the API base is empty (VITE_API_BASE="" → same origin, the
# host the SPA was served from). Vite inlines VITE_* from the environment at build time.
ENV VITE_USE_MOCK=false
ENV VITE_API_BASE=""
COPY . .
RUN pnpm --filter @dockos/web build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/package.json ./package.json
EXPOSE 8080
# No transpile: Node strips the TS types at load.
CMD ["node", "--experimental-strip-types", "apps/server/src/main.ts"]
