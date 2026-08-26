# Architecture

How Thunkin fits together and why. `docs/archive/PROJECT_PLAN.md` is the
original fourteen-agent plan for a public product, kept as history; most of it
was deliberately abandoned when this became a private, single-user service.
This file is what is true now, and `docs/BACKLOG.md` holds the decisions made
but not yet built.

---

## What this is

One person, one box, one API key. It runs on your own machine, is reached from
your own network, and generates on a key you pay for. That shapes nearly every
decision below — most of the hard parts of a public generation product are
defences against strangers, and there are no strangers here.

---

## Request path

```
Browser (Next.js RSC + client islands)
   │
   ▼
src/middleware.ts — closed by default; no unlock cookie, no entry
   │
   ▼
Next.js route handlers
   ├─ /api/unlock             → passphrase in, signed cookie out
   ├─ /api/jobs               → Generation Core → provider.submit()
   ├─ /api/assets/[id]        → bytes, from local disk
   ├─ /api/webhooks/fal       ← ED25519-verified callback (unreachable on a LAN)
   └─ /api/internal/sweep     ← manual poke at the reconciler
   │
   ├─────► Postgres   jobs · job_events · assets
   └─────► .storage/  re-hosted assets (provider URLs expire)
```

---

## Load-bearing decisions

### The provider is behind an interface, always

Nothing above `src/lib/provider/` imports fal. The `Provider` interface in
`src/lib/provider/types.ts` is the whole boundary: `submit`, `status`,
`result`, `cancel`, `verifyKey`. Two consequences worth stating:

- `FAL_MODE=mock` is a first-class mode, not a test hack. Every unit test, the
  whole e2e suite, and any local development run against it, so **a full CI run
  costs nothing**.
- `FAL_MODE=live` with no key throws at boot rather than silently falling back
  to the mock. A run that believes it is live but is not would be a far worse
  failure than a loud error.

### The reconciler is the completion path, not the safety net

fal retries a failed webhook roughly 31 times across an hour, but it **drops
deliveries to private IP addresses permanently** and **does not follow
redirects**. A box on your LAN has a private address by definition, so a
webhook-only design would never finish a single job here.

`src/lib/net/reachability.ts` decides whether fal could plausibly deliver:
loopback, RFC1918, `169.254`, CGNAT `100.64/10`, `.local`/`.lan`/`.home`, and
the IPv6 equivalents all mean no. When it says no, `submit` omits the
`fal_webhook` parameter entirely rather than generating an hour of retries for
a callback that cannot arrive.

| Path       | Trigger                              | When it applies     |
| ---------- | ------------------------------------ | ------------------- |
| Webhook    | fal POSTs `/api/webhooks/fal`        | public `PUBLIC_URL` |
| Reconciler | in-process 30s loop, plus every read | always              |

Both call the **same** idempotent `advanceJob`. Whichever arrives first wins;
the second is a no-op. Nothing is degraded when the webhook path is absent —
that case was designed for, and the integration suite proves a job reaching
`ready` with no webhook at all.

The reconciler also runs an **orphan pass**: a job that crashed between
creation and provider acceptance has no request id, so the poll path can never
see it. `findOrphanedJobs` catches those and expires them past their ceiling —
"zero orphaned jobs" is a property of this loop, backed by an integration
test, not an aspiration.

The loop lives in `src/lib/jobs/sweeper.ts` and starts lazily from
`maybeSweep()`. It is not an instrumentation hook: adding one makes Next
compile it for the Edge runtime too, where the asset pipeline's `node:fs`
imports cannot be bundled.

### One writer for job status

`src/lib/jobs/machine.ts` owns a pure `transition(job, event)`. Illegal
transitions throw. Every transition appends a `job_events` row recording which
subsystem drove it. **No other module writes `jobs.status`** — that single rule
is what makes "zero orphaned jobs" checkable rather than aspirational.

A transition into the status a job already holds returns `null` rather than
throwing. The webhook and the reconciler race by design and both are right; the
convergence rule is what lets them.

### The key is server-side and the passphrase is the whole boundary

There is no bring-your-own-key, no vault, no encryption at rest, and no
sessions table. `FAL_KEY` sits in the environment, `serverKeyResolver` reads
it, and that is the entire story.

What guards it is `APP_PASSPHRASE`: one field at `/unlock`, compared in
constant time (hashed first, so even the length is not observable), exchanged
for a signed cookie. The cookie's payload carries a truncated HMAC tag of the
passphrase and its issue time, both verified on every request — so **rotating
`APP_PASSPHRASE` logs every device out**, and the one-year lifetime is
enforced by the server, not politely suggested to the browser.
`src/middleware.ts` refuses everything else — closed by default, so a route
added tomorrow is protected before it is written. Missing secrets return 500
rather than failing open, a Host check closes DNS rebinding, and every private
route handler re-checks the cookie itself (`requireUnlocked`), so one typo in
the exemption list degrades to "two checks agree" instead of "no check at
all".

Exemptions are deliberate and short: `/api/webhooks/fal` (ED25519-verified,
and fal will never hold a cookie), `/api/internal/sweep` (its own shared
secret, header-only — never a query parameter), `/unlock` itself, and static
assets. Paths containing traversal or encoded escapes are never exempt.

Failed unlock attempts are limited by **one global in-memory bucket plus a
fixed delay** — keyed on nothing the caller sends, because anything a caller
sends, a caller can rotate.

**Stated plainly: anyone on your network who has the passphrase can spend your
money.** That is the accepted design, not an oversight.

### The unlocked visitor is the owner

Reads take no session at all: `getJob`, `listJobs` and `getAsset` answer for
the one owner, because your phone and your laptop are the same person and a
library that differs between them is a bug. `jobs.session_id` still records
which device made a thing — provenance on writes, a prefix on storage keys,
and the scope of the per-device idempotency index — but nothing reads it for
authorization. If this ever becomes multi-user, adding a parameter back to
three functions is a ten-minute change; carrying an ignored one everywhere in
the meantime was the worse deal.

### We re-host every asset

Provider result URLs expire. A library that 404s yesterday's images is
worthless, so each result is streamed into local storage on completion and
everything downstream reads our copy. `Asset.sourceUrl` is retained only for
debugging and **must never be rendered**.

Local disk under `.storage/` is the real implementation, not a stand-in —
this is one long-lived process on one machine, which is precisely the case a
filesystem serves well. `StoragePort` remains as the seam.

The consequence is a backup rule: `.storage/` and Postgres are a matched pair.
Either one alone is worthless.

### Polling, not streaming

The client polls. On a LAN with one user the difference from SSE is
imperceptible, and every read piggybacks a sweep, so watching a job is what
advances it. That removes a reconnect-and-backoff surface entirely.

---

## Job state machine

```
draft → submitting → queued → running → ingesting → ready
                 ↘         ↘        ↘         ↘
                   failed · canceled · expired
```

Terminal states are `ready`, `failed`, `canceled`, `expired`. `isTerminal()` in
`@/lib/contracts` is the only correct way to ask.

The reconciler backs off `2s → 5s → 15s → 60s`, capped at 5 minutes, and marks
a job `expired` past a hard ceiling (10 minutes image, 20 minutes video).
Claims use `FOR UPDATE SKIP LOCKED`, so a piggyback sweep and the interval loop
never fight over the same job.

---

## The contracts layer

`src/lib/contracts/` is the shared vocabulary. Everything imports from
`@/lib/contracts`, never from the individual files.

| Contract                                        | Behaviour behind it       |
| ----------------------------------------------- | ------------------------- |
| `Job`, `JobStatus`, `JobEvent`, `JobErrorCode`  | `src/lib/jobs/`           |
| `ApiJob`, `ApiJobWithAssets`, `toApiJob`        | the wire, exactly         |
| `Asset`, `PublicAsset`                          | `src/lib/assets/`         |
| `ModelDescriptor`, `ModelTier`, `ModelSupports` | `src/lib/models/registry` |
| `ApiResult<T>`, `ApiError`, `ok()`, `err()`     | every route handler       |

Three details that are load-bearing rather than stylistic:

- **`ApiJob` is what the client receives, and `toApiJob` is the only path to
  it.** It omits the server's bookkeeping (`sessionId`, `falRequestId`,
  `idempotencyKey`, `attempt`, `nextPollAt`) and types timestamps as the ISO
  strings JSON actually delivers — `Job`'s `Date` fields are the repository's
  truth, not the wire's. The client layer (`src/lib/client/api.ts`) parses
  every response against it, so a shape drift is an error at the boundary.
- `PublicAsset` deliberately omits `storageKey`, `sourceUrl` and `sessionId`.
  Bytes are served through `/api/assets/[id]`, behind the gate, so the storage
  layout is never public information.
- `ApiErrorCode` is a closed union that reuses `JobErrorCode`, and the
  `RECOVERY` map in `src/lib/jobs/recovery.ts` is typed against it — a new
  error code refuses to compile until it has recovery copy. "Never a dead
  end" is enforceable only because the list has no generic `UNKNOWN` member.
  Resist adding one.

---

## Database

`src/lib/db/tables/` holds one module per table, re-exported from
`schema.ts`. Two of them: `jobs` + `job_events`, and `assets`.

Indexes that matter: `jobs (session_id, created_at desc)`,
`jobs (status, next_poll_at)` — the reconciler's claim query depends on it —
and a unique `jobs (session_id, idempotency_key)`.

Schema changes go through committed migrations in `drizzle/`
(`pnpm db:generate`, then `pnpm db:migrate` — which the Docker image runs on
every boot). `db:push` remains only for the throwaway dev database; nothing
that holds real generations is ever touched by a tool willing to drop columns
on its own initiative.

---

## Testing the provider without spending money

The mock is not a stub that returns instantly. It advances through the real
`IN_QUEUE → IN_PROGRESS → COMPLETED` sequence on a compressed but proportional
delay curve, because the states the UI must render are exactly the ones a
too-fast mock would hide. Video visibly outlasts image.

Failure paths are reachable on purpose, via directives at the start of a
prompt:

| Directive    | Effect                                                      |
| ------------ | ----------------------------------------------------------- |
| `!fail:CODE` | Fails with that `JobErrorCode`                              |
| `!slow`      | Roughly 4× the normal duration                              |
| `!stall`     | Never completes — exercises the reconciler's expiry ceiling |

Directives stack: `!slow !fail:TIMEOUT a lighthouse`.

---

## Ports

Narrow interfaces in `src/lib/ports/` that were originally there to let
parallel agents avoid blocking each other. All three now have real
implementations; they stay because they cost nothing and are where a test
substitutes a fake.

| Port           | Implementation                        |
| -------------- | ------------------------------------- |
| `LookResolver` | `src/lib/models/registry.ts`          |
| `IngestPort`   | `src/lib/assets/ingest.ts`            |
| `KeyResolver`  | `src/lib/keys/server-key-resolver.ts` |

`LookResolver` does two deliberate steps: `normalizeParams` filters to what
the model supports and is what gets **stored** on the job, still in the
normalized vocabulary; `toProviderParams` builds the exact body the endpoint
wants, via a per-look adapter map beside the catalogue. The fal adapter is
transport-only — it owns no field names — which is what makes adding or
swapping a model one registry entry (plus an adapter when the endpoint is
quirky, plus a sample image). A unit test keeps `scripts/smoke-live.mjs`'s
endpoint list from drifting out of step.

`StoragePort` follows the same pattern one layer down, with a local-disk
implementation writing to `.storage/`.

---

## Two subtleties worth knowing before you touch this

**Cookies' `Secure` flag follows `PUBLIC_URL`, not `NODE_ENV`.** A `Secure`
cookie sent over plain HTTP is silently discarded by the client, and every
request then arrives unauthenticated — which looks like data loss rather than a
cookie problem. Plain HTTP is the normal case here, so this must follow the
scheme actually in use.

**The webhook re-reads status from the provider rather than trusting its
payload.** The delivery tells us _that_ something happened, not what to
believe. Re-reading means a replayed or reordered delivery cannot move a job
backwards, and it is why the webhook and reconciler paths cannot drift apart in
interpretation — both call `advanceJob`.

---

## Conventions

- Path alias `@/*` → `src/*`.
- Unit tests sit beside the code they cover (`*.test.ts`); e2e lives in
  `tests/e2e/`.
- Every route handler returns `ApiResult<T>` and nothing else.
- A resource that does not exist is a **404, never a 403** — a 403 confirms the
  id is real.
