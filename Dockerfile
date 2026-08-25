# Thunkin. Multi-stage so the running image carries no build toolchain.

FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The env contract validates at build time too, so these placeholders only have
# to satisfy its shape. Nothing here reaches a real service.
ENV DATABASE_URL=postgres://placeholder@localhost:5432/placeholder \
    SESSION_SECRET=build-time-placeholder-secret-not-used-at-runtime \
    APP_PASSPHRASE=build-placeholder \
    SWEEP_SECRET=build-placeholder-sweep \
    PUBLIC_URL=http://localhost:3000 \
    FAL_MODE=mock
RUN pnpm build

FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# next.config.ts and tsconfig.json are read at *start*, not only at build —
# without them `next start` runs on defaults and drizzle-kit cannot resolve the
# schema's TypeScript.
COPY package.json pnpm-lock.yaml next.config.ts tsconfig.json drizzle.config.ts ./
COPY src/lib/db ./src/lib/db
COPY scripts ./scripts

# Storage is a mounted volume in Compose; create it so a bare `docker run`
# still works.
RUN mkdir -p .storage

EXPOSE 3000

# Push the schema, then serve. `db:push` is idempotent, so this is safe on
# every restart and means there is no separate migration step to forget.
CMD ["sh", "-c", "pnpm db:push --force && pnpm start -H 0.0.0.0"]
