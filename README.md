# Thunkin

AI photo and video generation, at the press of a shutter button. Pick a look,
type a line, tap once, watch it arrive.

> **Status: Wave 0.** The foundation is in place — contracts, env, provider
> boundary, tooling, CI. The studio surface itself lands with AGENT-06. See
> [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the build order.

## Quickstart

Nothing here costs money. `FAL_MODE=mock` is the default and returns fixture
assets on a realistic delay curve, so you need no fal account to develop.

```bash
pnpm install
cp .env.example .env.local     # then fill in the three secrets it names
pnpm dev
```

`.env.example` documents every variable and includes the `node -e` one-liners
that generate the secrets. Only `DATABASE_URL`, `MASTER_KEY`, `SESSION_SECRET`
and `SWEEP_SECRET` are required to boot.

## Checks

```bash
pnpm verify        # typecheck + lint + unit — run this before pushing
pnpm test:e2e      # Playwright, five device profiles, mock provider
pnpm build
```

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
src/lib/provider/    the provider boundary; mock and (later) fal adapters
src/lib/db/          Drizzle connection; tables are added per-agent
src/lib/env.ts       env contract, validated at boot
src/app/             App Router surfaces
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
