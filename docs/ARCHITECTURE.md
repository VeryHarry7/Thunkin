# Architecture

The reference for how Thunkin fits together. `docs/PROJECT_PLAN.md` says what
we are building and who owns which piece; this says how the pieces connect.

---

## Request path

```
Browser (Next.js RSC + client islands)
   │  httpOnly signed session cookie
   ▼
Next.js route handlers
   ├─ /api/session/key        → Key Vault (AES-256-GCM, MASTER_KEY from env)
   ├─ /api/jobs               → Generation Core → provider.submit()
   ├─ /api/jobs/[id]/stream   → SSE progress
   ├─ /api/webhooks/fal       ← ED25519-verified provider callback
   └─ /api/internal/sweep     ← cron reconciler (the safety net)
   │
   ├─────► Postgres  sessions · jobs · job_events · assets · shares
   └─────► R2 / S3   re-hosted assets (provider URLs expire)
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
- `FAL_MODE=live` with no adapter installed throws at the call site rather than
  silently falling back to the mock. A deploy that believes it is live but is
  not would be a far worse failure than a loud error.

### A webhook is not enough on its own

fal retries a failed webhook roughly 31 times across an hour, but it **drops
deliveries to private IP addresses permanently** and **does not follow
redirects**. A webhook-only design loses jobs — silently, and only in
production, where `PUBLIC_URL` is the one thing that differs from a laptop.

So there are two paths to the same place:

| Path    | Trigger                         | Typical latency   |
| ------- | ------------------------------- | ----------------- |
| Webhook | fal POSTs `/api/webhooks/fal`   | ~immediate        |
| Sweeper | cron hits `/api/internal/sweep` | next backoff tick |

Both call the **same** idempotent `transition()`. Whichever arrives first wins;
the second is a no-op. The ratio between them is a monitored metric
(AGENT-12) — a rising sweeper share is the early warning that webhooks broke.

### One writer for job status

`src/lib/jobs/machine.ts` owns a pure `transition(job, event)`. Illegal
transitions throw. Every transition appends a `job_events` row recording which
subsystem drove it. **No other module writes `jobs.status`** — that single rule
is what makes "zero orphaned jobs" checkable rather than aspirational.

### The visitor's key rests server-side

This app is bring-your-own-key: we never hold a fal key of our own, and the
visitor's key pays for their own inference.

The key cannot live only in a cookie, because the webhook handler and the
sweeper act on jobs when **no request from that visitor is in flight** — they
still need to poll status and fetch results. So the key is encrypted with
AES-256-GCM under `MASTER_KEY` and stored as ciphertext on the session row;
the cookie carries only the session id.

That is a real tradeoff and worth naming plainly: **a server compromise
exposes stored keys.** Mitigations are in `docs/SECURITY.md` (AGENT-03), and
the honest version of this statement is shown to visitors at key entry.

### We re-host every asset

Provider result URLs expire. A library that 404s yesterday's images is
worthless, so AGENT-05 streams each result into our own bucket on completion
and everything downstream reads our copy. `Asset.sourceUrl` is retained only
for debugging and **must never be rendered**.

### No Redis

SSE reads job state from Postgres on a short server-side interval. Serverless
platforms cap connection duration, so the client reconnects with backoff and
falls back to interval polling — that fallback is expected behaviour, not an
error path, and has to be good enough to ship on its own.

---

## Job state machine

```
draft → submitting → queued → running → ingesting → ready
                 ↘         ↘        ↘         ↘
                   failed · canceled · expired
```

Terminal states are `ready`, `failed`, `canceled`, `expired`. `isTerminal()` in
`@/lib/contracts` is the only correct way to ask.

The sweeper backs off `2s → 5s → 15s → 60s`, capped at 5 minutes, and marks a
job `expired` past a hard ceiling (10 minutes image, 20 minutes video).

---

## The contracts layer

`src/lib/contracts/` is the API between agents. Everything imports from
`@/lib/contracts`, never from the individual files.

| Contract                                        | Owner of the behaviour behind it |
| ----------------------------------------------- | -------------------------------- |
| `Job`, `JobStatus`, `JobEvent`, `JobErrorCode`  | AGENT-04                         |
| `Asset`, `PublicAsset`, `Share`                 | AGENT-05, AGENT-08               |
| `ModelDescriptor`, `ModelTier`, `ModelSupports` | AGENT-02                         |
| `ApiResult<T>`, `ApiError`, `ok()`, `err()`     | every route handler              |
| `parseOrThrow`, `issuesToFields`                | every trust boundary             |

**Changing an exported shape is a cross-agent break.** Open a note in
`docs/handoffs/` before you do.

Two details that are load-bearing rather than stylistic:

- `PublicAsset` deliberately omits `storageKey`, `sourceUrl` and `sessionId`.
  What the client receives is a signed, short-lived URL — the bucket layout is
  not public information.
- `ApiErrorCode` is a closed union that reuses `JobErrorCode`. A failure means
  the same thing whether it surfaces on submit or arrives later on the job
  record, and "never a dead end" is enforceable only because the list has no
  generic `UNKNOWN` member. Resist adding one.

---

## Database ownership

`src/lib/db/schema.ts` is intentionally empty of tables in Wave 0. Each agent
adds its own module under `src/lib/db/tables/` and re-exports it, so
`drizzle-kit` sees one schema surface while ownership stays split:

| Tables               | Owner    |
| -------------------- | -------- |
| `sessions`           | AGENT-03 |
| `jobs`, `job_events` | AGENT-04 |
| `assets`             | AGENT-05 |
| `shares`             | AGENT-08 |

Indexes that matter, specified now so they are not forgotten later:
`jobs (session_id, created_at desc)`, `jobs (status, next_poll_at)` — the
sweeper's claim query depends on it — and a unique
`jobs (session_id, idempotency_key)`.

---

## Testing the provider without spending money

The mock is not a stub that returns instantly. It advances through the real
`IN_QUEUE → IN_PROGRESS → COMPLETED` sequence on a compressed but proportional
delay curve, because the states the UI must render are exactly the ones a
too-fast mock would hide. Video visibly outlasts image.

Failure paths are reachable on purpose, via directives at the start of a
prompt:

| Directive    | Effect                                                   |
| ------------ | -------------------------------------------------------- |
| `!fail:CODE` | Fails with that `JobErrorCode`                           |
| `!slow`      | Roughly 4× the normal duration                           |
| `!stall`     | Never completes — exercises the sweeper's expiry ceiling |

Directives stack: `!slow !fail:TIMEOUT a lighthouse`.

---

## Conventions

- Path alias `@/*` → `src/*`.
- Unit tests sit beside the code they cover (`*.test.ts`); e2e lives in
  `tests/e2e/`.
- Every route handler returns `ApiResult<T>` and nothing else.
- A resource belonging to another session is a **404, never a 403** — a 403
  confirms the resource exists.
- Don't edit another agent's files. Record the request in `docs/handoffs/`.
