# Handoff — where this stands and what comes next

> Written 2026-08-26 at the end of the pre-live hardening pass; updated the
> same day after the service went live on Windows and the live smoke found
> four real bugs.
> Branch: `claude/ai-photo-video-site-plan-ruxvfx`. Working tree clean;
> everything is pushed.
>
> Reading order for a fresh start: this file → `docs/ARCHITECTURE.md` (what is
> true) → `docs/BACKLOG.md` (what is decided but unbuilt). `docs/archive/`
> is history; do not build against it.

## What this project is now

A private, single-user AI image/video studio for one owner's own machine,
reached over the LAN (phone included), generating on one server-side
`FAL_KEY`, gated by one passphrase. It began as a fourteen-agent plan for a
public BYOK product; that plan was deliberately abandoned and archived.

## The story so far, in commits

| Commits             | What happened                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `948051c`–`01ea54c` | Foundation: contracts, mock/live provider boundary, job state machine, reconciler, webhook verification, CI                                             |
| `04c3eb2`           | Vertical slice: tokens/primitives, four-look registry, asset pipeline, the Studio                                                                       |
| `69f00e9`           | **Re-scope to private single-user LAN service**: server key, passphrase gate, shared library, no-webhook-on-LAN, local disk, /library, deployment files |
| `3aa9a7f`–`72baf5a` | **Nine-phase hardening pass** (see below)                                                                                                               |
| `dde2528`–`75204ce` | **Go-live fixes** — four bugs only a real key and a real network could find (see "What going live cost")                                                |

The hardening pass, one commit per phase: (1) gate hardening — passphrase-
bound, age-checked cookies; unspoofable global rate limit; header-only sweep
secret; per-route `requireUnlocked`; Host check; (2) `ApiJob` wire contract —
no more `sessionId`/`falRequestId` leaking, ISO-string dates; (3) jobs-core
bugs — orphan expiry pass, cancel-during-ingest absorbed, exact-bytes asset
serving; (4) dead code and doc cleanup — BYOK residue, poster plumbing,
AGENT-era comments all gone; (5) **model-swap seam** — per-look payload
adapters, transport-only fal adapter; (6) one signing implementation, fake
`_sessionId` seam removed; (7) one client API layer + `useJobs` poll loop +
shared `JobTile`, Studio split; (8) committed migrations replace
`db:push --force` in the Docker boot; (9) traversal-guard and reachability
boundary tests, docs made accurate.

Test counts at head: **236 unit · 27 integration · 91 e2e** (five viewports),
plus a production build. CI enforces all of it, mock-only, spending nothing.

## What going live cost

Four bugs survived every mock test, two adversarial audits and a nine-phase
hardening pass. Each is now pinned by tests, and each says something about
where mock coverage stops:

1. **Mock mode could not generate without a `FAL_KEY`.** `.env.example` ships
   `FAL_KEY=` empty, which normalises to unset, so `getKey()` returned null and
   `submitJob` threw `NO_KEY` before the mock provider was ever reached — the
   documented quickstart was broken. Every test supplied a key. Fixed with a
   sentinel `MOCK_KEY` in `server-key-resolver.ts`.
2. **An exhausted fal balance was reported as a bad key.** fal answers a
   billing lock with **403**, not 402, so it mapped to `INVALID_KEY` and the app
   told the owner to check a key that was perfectly good, while
   `INSUFFICIENT_CREDIT` sat unreachable. Fixed by inspecting the body.
3. **The smoke verdict misdirected, twice** — first blaming `registry.ts` for a
   billing lockout, then announcing "every endpoint failed" when one of two had
   just succeeded. Extracted to a pure function (`scripts/smoke-verdict.mjs`)
   with both real outputs pinned as tests.
4. **Queue polling used the wrong URL.** fal's queue accepts a submit at the
   full endpoint path but serves status/result/cancel only at the **base app**
   (first two segments); the full path returns a zero-byte 405. Three of the
   four looks would have submitted, charged, and then failed as `MODEL_ERROR`.
   No test could have caught it: every provider test used a single-segment id,
   and the mock builds no URLs. Fixed with `queueAppId()`.

The pattern worth keeping: mock coverage proves the shape of a conversation,
never the other end of it.

## What is verified, and what is not

Verified end to end: the whole loop against fixtures (submit → queue →
generate → ingest → library → download → delete), the passphrase gate on
every viewport, the reconciler completing jobs with no webhook, migrations on
a fresh database, cookie compatibility across the signing consolidation.

Verified live, on the owner's Windows box, with a real key: submit → queue →
poll → ingest → asset, on both image endpoints — `fal-ai/flux/schnell` and
`fal-ai/nano-banana-pro`.

**Not yet verified — the owner's list:**

1. **The two video endpoints.** `fal-ai/veo3.1/fast` and
   `fal-ai/kling-video/v3/pro/text-to-video`, plus their string-duration
   adapters, are verified against fal's docs, not against the live API.
   `node scripts/smoke-live.mjs --video` settles it for about $1.60.
2. **The FLUX `image_size` adapter.** The smoke sends a bare prompt, so the
   per-look payload adapters are untested live. One Quick Sketch generation
   through the UI at `FAL_MODE=live` covers it for about $0.003.
3. **Docker Compose has never booted.** Written and parse-validated in an
   environment with no Docker daemon. The bare-metal path
   (`pnpm build && pnpm start -H 0.0.0.0`) has been run end to end — on
   Windows, natively.
4. **No real phone has touched it.** Five emulated viewports pass; real
   Safari rendering is a known gap of the Chromium-only matrix. The LAN steps
   (`PUBLIC_URL` → LAN IP, `pnpm start -H 0.0.0.0`, firewall rule) are
   written but not yet walked.

## What comes next, in order

1. **One live Quick Sketch through the UI** — the cheapest way to exercise the
   FLUX `image_size` adapter, which the smoke does not reach.
2. **Go live on the LAN** — README's "Running it for real" section is
   current. `PUBLIC_URL` to the LAN IP, `pnpm start -H 0.0.0.0`, open the
   Windows Firewall on the port, then first unlock from the phone and verify
   its library matches the laptop's.
3. **Image-to-image** — the first feature, design already decided and written
   in `docs/BACKLOG.md`: fal storage upload API for delivery,
   `refImages: string[]` in the contract, per-model mapping in the adapters.
   Needs: an upload route (behind the gate), a composer dropzone, upload
   ingestion into `.storage/`.
4. **More models** — now genuinely one `LOOKS` entry + optional adapter +
   sample image. Smoke each addition.
5. Backlog beyond that, when wanted: persist the result seed (needs a
   migration — the workflow exists now), landing wall from real generations,
   video poster frames (ffmpeg).

## Resuming work: mechanics and traps

```bash
./scripts/dev-db.sh start && pnpm db:push   # throwaway dev DB on :5433
pnpm verify                                  # typecheck + lint + unit
pnpm test:integration                        # skips cleanly without the DB
pnpm test:e2e                                # 91 tests; builds its own server
```

Hard-won session lessons, so they are paid for only once:

- **Never pipe the e2e run through `tail` or believe a piped exit code.** It
  hid five real failures for eight phases (`72baf5a`'s message has the full
  confession). Log to a file, check the suite's own exit status, and read
  the `N failed` line — "91 passed" can appear above failures.
- Playwright's `reuseExistingServer` (non-CI) will happily test a **stale
  server** left on port 3100 — `pkill -f next-server` before trusting a run,
  and note the process is named `next-server`, not "next start".
- The integration harness and the app must agree on `DATABASE_URL`; the
  vitest integration config pins the :5433 default for exactly that reason.
- Unit tests need no `.env` (test defaults); `.env.local` is gitignored and
  must stay that way.
- Schema changes: edit `src/lib/db/tables/`, `pnpm db:generate`, commit the
  new file in `drizzle/`. `db:push` is for the dev DB only.
- Rotating `APP_PASSPHRASE` signs every device out — that is a feature, and
  the recovery move if a device is ever untrusted.
- CI green is checked on GitHub directly, never assumed from local runs.
- **A known UX gap, offered and not yet taken up:** the client swallows 401s,
  so rotating `APP_PASSPHRASE` silently bricks an open tab rather than
  re-showing the gate. Harmless, but confusing the first time it happens.

## Accepted tradeoffs (deliberate, documented, not bugs)

Plain HTTP on the LAN; the passphrase as the entire boundary; one box, one
disk (back up `.storage/` and Postgres **together**); fal `errorMessage`
shown to the owner; no push channel (polling is the design on a LAN).
