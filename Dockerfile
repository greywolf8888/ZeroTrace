FROM node:26.7.0-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json tsconfig.packages.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/identifiers/package.json packages/identifiers/package.json
COPY packages/evidence/package.json packages/evidence/package.json
COPY packages/chain-adapters/package.json packages/chain-adapters/package.json
COPY packages/platform-adapters/package.json packages/platform-adapters/package.json
COPY packages/entity-engine/package.json packages/entity-engine/package.json
COPY packages/rv/package.json packages/rv/package.json

RUN npm ci --no-audit --no-fund

COPY apps ./apps
COPY packages ./packages
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:26.7.0-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages ./packages
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:8080/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/src/server.js"]

FROM nginx:1.29-alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=4s --start-period=5s --retries=4 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

FROM postgres:17.10-alpine AS postgres
COPY infra/postgres/init/*.sql /docker-entrypoint-initdb.d/

FROM clickhouse/clickhouse-server:26.7.3.19-alpine AS clickhouse
COPY infra/clickhouse/init/*.sql /docker-entrypoint-initdb.d/
