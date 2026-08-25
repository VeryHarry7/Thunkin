# Thunkin

A private AI image and video studio. Pick a look, type a line, tap once, watch
it arrive. Runs on your own machine, reachable from your phone on the same
network, generating on one API key that you pay for.

> **Status:** the whole loop works end to end against fixtures. The four fal
> model ids are verified as _listed_ in fal's catalogue but have never been
> called for real — run the live smoke below before trusting them.

## Quickstart

Nothing costs money until you set `FAL_MODE=live`. The default returns fixture
images on a realistic delay curve, which is enough to develop against.

```bash
pnpm install
cp .env.example .env.local        # fill in the passphrase and two secrets
pnpm db:start                     # throwaway Postgres, no Docker needed
pnpm db:push
pnpm dev
```

Open http://localhost:3000, enter your passphrase, and generate something.

## Running it for real

### On your own box, reachable from your phone

Set `PUBLIC_URL` to the machine's LAN address — not `localhost`, which only
works on the host itself:

```bash
ip addr | grep 'inet 192'          # Linux
ipconfig getifaddr en0             # macOS
```

Then:

```bash
# .env.local
FAL_MODE=live
FAL_KEY=your-key-id:your-key-secret
PUBLIC_URL=http://192.168.1.20:3000

pnpm build
pnpm start -H 0.0.0.0              # -H is what lets your phone connect
```

Your phone opens `http://192.168.1.20:3000`, enters the passphrase once, and
stays unlocked for a year.

**Docker Compose** does the same thing plus Postgres and restart-on-reboot:

```bash
docker compose up -d --build
```

One honest caveat: the Compose setup was written in an environment with no
Docker daemon, so it has been validated as _parsing_ but never actually booted.
The bare-metal path above has been run end to end.

### Keeping it running

`systemd`, if you want it back after a reboot without Docker:

```ini
# /etc/systemd/system/thunkin.service
[Unit]
Description=Thunkin
After=network.target postgresql.service

[Service]
WorkingDirectory=/path/to/Thunkin
EnvironmentFile=/path/to/Thunkin/.env.local
ExecStart=/usr/bin/pnpm start -H 0.0.0.0
Restart=always
User=youruser

[Install]
WantedBy=multi-user.target
```

## Verifying the model ids

Every fal endpoint id was checked against fal's live catalogue, and none has
been exercised. This is the one step that needs your real key:

```bash
node scripts/smoke-live.mjs           # one image, roughly a cent
node scripts/smoke-live.mjs --video   # adds video, roughly $1.50
```

Expect an id or two to be wrong. Fix them in `src/lib/models/registry.ts` —
adding or correcting a model is a one-file change.

## Checks

```bash
pnpm verify            # typecheck + lint + unit
pnpm test:integration  # real Postgres; skips cleanly without one
pnpm test:e2e          # Playwright, five viewports, through the real gate
```

Unit tests need no `.env`: under `NODE_ENV=test` the env contract fills in
obvious fakes, so a test that reaches a real service is a bug in the test.

## Working against fixtures

Prompt directives make the mock provider fail on purpose, so error handling can
be exercised without spending anything:

| Prompt prefix         | Effect                                         |
| --------------------- | ---------------------------------------------- |
| `!fail:INVALID_KEY …` | Fails with that error code                     |
| `!slow …`             | Roughly 4× the normal duration                 |
| `!stall …`            | Never completes — exercises the expiry ceiling |

They stack: `!slow !fail:TIMEOUT a lighthouse at dusk`.

## Backups

`.storage/` holds the generated files and Postgres holds everything about them.
**They are a matched pair.** Backing up one without the other leaves you with
images you cannot find or records pointing at files that are gone.

```bash
pg_dump "$DATABASE_URL" > backup.sql
tar czf storage.tar.gz .storage/
```

Under Compose those live in the `db-data` and `storage` volumes.

## How it fits together

```
src/lib/contracts/   shared types and Zod schemas
src/lib/provider/    the fal boundary; mock and live adapters
src/lib/jobs/        state machine, repository, service, reconciler
src/lib/assets/      download, derive, store
src/lib/storage/     local disk behind a port
src/lib/auth/        the passphrase gate
src/middleware.ts    what closes everything by default
src/app/             studio, library, unlock, API routes
```

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces connect and why
- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) — the original plan, most of it
  now deliberately abandoned

## Things worth knowing

**fal cannot reach a home network.** It drops webhook deliveries to private
addresses permanently, so the app detects a private `PUBLIC_URL` and stops
asking for callbacks it would never receive. A built-in reconciler polls every
30 seconds instead, and that is what actually finishes your jobs. Nothing is
degraded by this; the lifecycle was built for it.

**The passphrase is the whole boundary.** Anyone on your network who has it can
generate, and generating spends money on your key. Pick something real.

**Plain HTTP is a deliberate choice.** TLS on a LAN means a self-signed
certificate and a trust prompt on every device — real friction against a threat
(someone already inside your network) that the passphrase does not pretend to
stop either.

**One box, one disk.** No redundancy. If the disk dies, the library dies.
