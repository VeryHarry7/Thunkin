# Thunkin

AI photo and video generation, at the press of a shutter button. Pick a look,
type a line, tap once, watch it arrive.

> **Status: the generation core works end to end.** Wave 0 (foundation) and
> AGENT-04 (job lifecycle, provider adapters, webhook, reconciler) are in. You
> can submit a job over HTTP today and watch it reach `ready`. The studio UI
> lands with AGENT-06. See [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md).

## Quickstart

Nothing here costs money. `FAL_MODE=mock` is the default and returns fixture
assets on a realistic delay curve, so you need no fal account to develop.

```bash
pnpm install
cp .env.example .env.local     # then fill in the three secrets it names
pnpm db:start                  # throwaway Postgres, no Docker needed
pnpm db:push
pnpm dev
```

Try the loop:

```bash
curl -sc /tmp/j -b /tmp/j -X POST localhost:3000/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{"lookId":"seed-image","params":{"prompt":"a lighthouse at dusk"}}'

# then poll — the job advances even with no cron and no webhook
curl -sb /tmp/j localhost:3000/api/jobs
```

Set `DEV_FAL_KEY` in `.env.local` to any `id:secret`-shaped string; it stands in
for AGENT-03's vault and is refused outright when `FAL_MODE=live`.

`.env.example` documents every variable and includes the `node -e` one-liners
that generate the secrets. Only `DATABASE_URL`, `MASTER_KEY`, `SESSION_SECRET`
and `SWEEP_SECRET` are required to boot.

## Checks

```bash
pnpm verify           # typecheck + lint + unit — run this before pushing
pnpm test:integration # real Postgres; skips cleanly if none is running
pnpm test:e2e         # Playwright, five device profiles, mock provider
pnpm build
```

Integration tests use a real database on purpose: the reconciler's claim query
relies on `FOR UPDATE SKIP LOCKED`, which has no meaningful behaviour against a
fake. `pnpm db:start` brings one up from the Postgres binaries already on the
machine — no Docker daemon required.

Unit tests need no `.env` file: under `NODE_ENV=test` the env contract fills in
obvious fakes, so a test that reaches a real service is a bug in the test.

## Working against the mock

Prompt directives make the mock fail on purpose, so error handling can be
exercised end to end:

| Prompt prefix         | Effect                                         |
| --------------------- | ---------------------------------------------- |
| `!fail:INVALID_KEY …` | Fails with that error code                     |
| `!slow …`             | Roughly 4× the normal duration                 |
| `!stall …`            | Never completes — exercises the expiry ceiling |

They stack: `!slow !fail:TIMEOUT a lighthouse at dusk`.

## Layout

```
src/lib/contracts/   the API between agents — shared types and Zod schemas
src/lib/provider/    the provider boundary; mock and fal adapters
src/lib/ports/       interfaces for what sibling agents own, with dev stand-ins
src/lib/jobs/        state machine, repository, service, sweeper
src/lib/webhooks/    ED25519 verification for fal callbacks
src/lib/db/          Drizzle connection; tables are added per-agent
src/lib/env.ts       env contract, validated at boot
src/app/api/         route handlers
tests/integration/   lifecycle scenarios against real Postgres
tests/e2e/           Playwright
```

## Docs

- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) — goals, agent checklists, sequencing
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces connect and why
- [`docs/handoffs/`](docs/handoffs/) — cross-agent change requests

## A note on keys

Thunkin is bring-your-own-key: it holds no fal key of its own, and each
visitor's own key pays for their own generations. That key is encrypted at rest
under `MASTER_KEY` and never leaves the server after entry. The tradeoffs are
written out plainly in `docs/ARCHITECTURE.md`.
