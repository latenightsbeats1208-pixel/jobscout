# JobScout auto-hébergé (homelab, serveur) : une image, une base SQLite dans le
# volume /data, écoute sur 0.0.0.0:3000 derrière un reverse proxy (Traefik).
#
#   docker compose up -d --build
#
# WITH_LINKEDIN=1 (défaut) embarque le moteur Chromium de la source LinkedIn
# (~300 Mo de plus) ; WITH_LINKEDIN=0 pour une image plus légère.

ARG NODE_VERSION=24

# ---------------------------------------------------------------- build
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    JOBSCOUT_DOCKER_BUILD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-bookworm-slim
ARG WITH_LINKEDIN=1
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    JOBSCOUT_SERVER_MODE=1 \
    JOBSCOUT_DOCKER_BUILD=1 \
    JOBSCOUT_DATA_DIR=/data \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORT=3000 \
    TZ=Europe/Paris
# Certificats et fuseaux horaires : fournis par Node lui-même (magasin de CA et ICU
# complets embarqués), aucun paquet système à ajouter. Le processus init qui relaie
# les signaux est celui de Docker (`init: true` dans docker-compose.yml).

COPY --from=build --chown=node:node /app /app

# Moteur LinkedIn : Chromium « headless shell » et ses bibliothèques système.
RUN if [ "$WITH_LINKEDIN" = "1" ]; then \
      node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
      && rm -rf /var/lib/apt/lists/* \
      && chown -R node:node /ms-playwright; \
    else mkdir -p /ms-playwright && chown node:node /ms-playwright; fi

RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
