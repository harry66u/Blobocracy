# Blobocracy: one image for every Fly process group (sim, edge, burst). Draft, not deployed yet.
# uWebSockets.js ships glibc binaries, so the base is Debian slim (not Alpine).

# ── build: install the workspace and build the client ────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
# uWebSockets.js is installed from GitHub.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sim/package.json packages/sim/
COPY packages/edge/package.json packages/edge/
COPY packages/client/package.json packages/client/
COPY packages/bots/package.json packages/bots/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── run: Node 22 running the TypeScript sources through tsx (no separate server build step) ──
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/sim ./packages/sim
COPY --from=build /app/packages/edge ./packages/edge
COPY --from=build /app/packages/client/dist ./packages/client/dist
EXPOSE 8080 8081
# fly.toml [processes] picks the sim or an edge (edge, burst); the edge is the default.
CMD ["node", "--import", "tsx", "packages/edge/src/main.ts"]
