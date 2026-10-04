FROM node:24.11.1-bookworm-slim AS builder
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts --no-audit --no-fund && npm run arc:build

FROM node:24.11.1-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production ARC_API_HOST=0.0.0.0
COPY --from=builder --chown=node:node /app /app
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund
USER node
EXPOSE 8087
CMD ["node", "apps/arc-task-ledger-api/dist/server.js"]

FROM nginxinc/nginx-unprivileged:1.28.0-alpine AS web
COPY --from=builder /app/apps/arc-task-ledger-web/dist /usr/share/nginx/html
COPY infra/northflank/nginx.conf.template /etc/nginx/arc-template.conf
COPY --chmod=755 infra/northflank/web-entrypoint.sh /arc-web-entrypoint.sh
USER 101
EXPOSE 8080
ENTRYPOINT ["/arc-web-entrypoint.sh"]
