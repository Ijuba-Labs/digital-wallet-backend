FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
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
USER node
EXPOSE 9000
CMD ["node", "dist/server.js"]
