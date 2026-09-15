# Grain Tracker v2 — full-stack (Vite frontend + Hono/tRPC API + Drizzle/MySQL)
#
# The build context is the REPO ROOT: this is an npm-workspaces monorepo
# (app/, office/) and the code shared by both deployments lives in shared/.
#   docker build -f app/Dockerfile .
FROM node:20-slim AS build
ARG APP_DIR=app
WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# npm ci needs the root manifest/lock plus every workspace manifest
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY office/package.json office/
RUN npm ci

COPY ${APP_DIR}/ ./${APP_DIR}/
COPY shared/ ./shared/
RUN npm run build --workspace ${APP_DIR}

# Production-only dependencies (same toolchain so native modules build)
FROM node:20-slim AS deps-prod
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY office/package.json office/
RUN npm ci --omit=dev && npm cache clean --force

# Runtime: no build toolchain, no sources, unprivileged user
FROM node:20-slim AS runtime
ARG APP_DIR=app
WORKDIR /srv/${APP_DIR}
ENV NODE_ENV=production
# Day boundaries (daily report / EOD close) follow the container clock —
# override for your locale, e.g. -e TZ=America/Chicago. Keep MySQL on the
# same zone so TIMESTAMP conversion stays consistent.
ENV TZ=UTC

# Hoisted workspace node_modules (dist/boot.js resolves them from /srv/node_modules)
COPY --from=deps-prod /srv/node_modules /srv/node_modules
COPY --from=build /srv/${APP_DIR}/dist ./dist
# Shared drizzle migrations (resolved at boot as ../shared/db/migrations
# relative to the process cwd)
COPY shared/db/migrations /srv/shared/db/migrations

# Unprivileged runtime user; ./data is where offline mode would write
RUN useradd --system --create-home grain \
    && mkdir -p /srv/${APP_DIR}/data && chown grain:grain /srv/${APP_DIR}/data
USER grain

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Boots dist/boot.js: applies DB migrations (+ demo seed only when SEED_DEMO
# is enabled and the database is empty), then serves.
CMD ["node", "dist/boot.js"]
