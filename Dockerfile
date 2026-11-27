# syntax=docker/dockerfile:1
# Deal search: Next.js 16 standalone server + Google Chrome stable (headed, on Xvfb) for noon/SHEIN.
# Build and run with docker compose (see docker-compose.yml and docs/DEPLOY.md).

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------- build: full install, next build (output: "standalone") ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- prod-deps: production node_modules ----------
# The standalone trace covers what the server imports; scripts/install-specs.mjs also runs the
# api-anything CLI (dist/cli.js) as a separate process, so the full production tree is laid over it.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
ARG DEBIAN_FRONTEND=noninteractive
# Google Chrome stable from Google's apt repository (amd64), Xvfb for a headed Chrome without a
# monitor (noon and SHEIN block headless Chrome), fonts so product pages render, tini as init,
# curl for the healthcheck, sqlite3 for scripts/backup.sh.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      google-chrome-stable xvfb xauth tini sqlite3 \
      fonts-noto-core fonts-noto-color-emoji fonts-noto-cjk \
 && apt-get purge -y gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    # Our handler (src/lib/shutdown-hooks.ts) closes Chrome and the DB on SIGTERM instead of Next's.
    NEXT_MANUAL_SIG_HANDLE=true \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DISPLAY=:99 \
    CHROME_PATH=/usr/bin/google-chrome-stable \
    DEAL_SEARCH_DB=/data/data.db \
    API_ANYTHING_HOME=/data/aa-home \
    NOON_PROFILE_DIR=/data/noon-profile \
    SHEIN_PROFILE_DIR=/data/shein-profile

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node api-specs ./api-specs
COPY --chown=node:node scripts/install-specs.mjs ./scripts/install-specs.mjs
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/deal-search-entrypoint

# Non-root. /data is the persistent volume (a new named volume copies this ownership).
RUN install -d -o node -g node /data /tmp/.X11-unix -m 1777 \
 && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# tini -s: a correct init even when compose adds its own (init: true); it forwards SIGTERM to node.
ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/usr/local/bin/deal-search-entrypoint"]
