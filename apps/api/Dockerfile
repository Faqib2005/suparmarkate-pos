FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/mobile-scanner/package.json apps/mobile-scanner/package.json
COPY packages packages

RUN npm ci --legacy-peer-deps --workspace @supermarket/api --workspace @supermarket/desktop --include-workspace-root

COPY apps/api apps/api
COPY apps/desktop apps/desktop
COPY scripts/docker scripts/docker

RUN sed -i 's/\r$//' /app/scripts/docker/api-entrypoint.sh

ENV DATABASE_URL="postgresql://supermarket:supermarket_password@postgres:5432/supermarket_db"
ENV WEB_APP_ENABLED="true"
ENV WEB_DIST_DIR="/app/apps/desktop/dist"

WORKDIR /app/apps/desktop
RUN npm run build

WORKDIR /app/apps/api
RUN npm run prisma -- generate && npm run build

EXPOSE 4000 4001 4002

ENTRYPOINT ["sh", "/app/scripts/docker/api-entrypoint.sh"]
