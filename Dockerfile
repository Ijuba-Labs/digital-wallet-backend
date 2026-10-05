# syntax=docker/dockerfile:1
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
COPY scripts/install-release.mjs ./scripts/
RUN --mount=type=secret,id=github_packages_token,required=true \
    NODE_AUTH_TOKEN="$(cat /run/secrets/github_packages_token)" node scripts/install-release.mjs
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY assets ./assets
COPY scripts/resolve-build-imports.mjs scripts/clean-build.mjs ./scripts/
RUN pnpm build && pnpm prune --prod

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json pnpm-lock.yaml knexfile.cjs ./
COPY src/database/schema.sql ./src/database/schema.sql
COPY src/database/knex-migrations ./src/database/knex-migrations
COPY src/database/upgrade-utils.cjs ./src/database/upgrade-utils.cjs
COPY --from=builder /app/assets ./assets
USER node
EXPOSE 9000
CMD ["node", "dist/server.js"]
