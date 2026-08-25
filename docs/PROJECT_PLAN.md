# Thunkin — AI Photo & Video Studio: Project Plan

## Context

`VeryHarry7/Thunkin` is currently an empty repository (one `README.md`, one commit). Everything below is greenfield.

**What we're building:** a web app that makes generating AI images and video feel like pressing a shutter button — pick a look, type a line, tap once, watch it arrive. It must be exceptionally good-looking and genuinely pleasant to move through, on a phone as much as on a desktop. Behind that, a backend whose job lifecycle is boring, observable, and impossible to lose track of.

**Why the plan is shaped this way:** the hard problems here are not "call a model." They are (1) async jobs that take 10s–6min and can fail silently, (2) making a many-knob domain feel like few-knob, and (3) BYOK — the user supplies their own fal.ai key, which is excellent for cost and abuse risk but is the single biggest threat to "a few buttons." Three workstreams exist specifically to absorb that friction.

**Decisions already made** (from clarification):
- **Provider:** fal.ai primary, behind a thin adapter. Its unified queue API covers Veo 3.1, Kling 3.0, Seedance, FLUX.2, Nano Banana Pro, Seedream 4.5 under one auth + one call pattern.
- **Accounts:** none. Anonymous, cookie-scoped sessions.
- **Cost model:** bring-your-own fal key. We pay for zero inference.
- **Mobile:** one responsive codebase, mobile-first shell, server-side device hint to avoid layout flash. Not separate routes.
- **Stack:** Next.js App Router (TypeScript) + Postgres (Drizzle) + S3-compatible object storage (R2). No Redis.
- **Aesthetic:** dark cinematic studio.

---

## Part 1 — Product Model

Everything downstream is judged against this section. Agents resolve ambiguity by re-reading it, not by inventing.

### North star
> A person with an idea and a fal key gets a beautiful image in under 30 seconds and a beautiful video in under 3 minutes, having made at most three decisions.

### The core loop (the only loop that matters)
```
LOOK  →  SAY  →  GO  →  WATCH  →  KEEP
```
1. **Look** — pick a visual direction from a gallery of live examples, not a dropdown of model IDs.
2. **Say** — one prompt field. Everything else is optional and collapsed.
3. **Go** — one primary button. Always enabled or clearly explaining why not.
4. **Watch** — the wait is designed, not endured. Progress is honest, the surface stays alive, leaving the page does not lose the job.
5. **Keep** — result lands in a library that survives refresh, downloads in one tap, shares by link.

### Design principles
| Principle | Consequence |
|---|---|
| **The output is the interface** | Chrome is near-black and near-silent. Generated media is the only saturated color on screen. |
| **Hide the model, sell the look** | Users choose "Cinematic Portrait," not `fal-ai/flux-2/pro`. Model IDs live in a registry, surfaced only in an advanced disclosure. |
| **Never a dead end** | Every failure state names a cause and offers exactly one next action (retry, edit prompt, swap model, fix key). |
| **The wait is part of the product** | No spinner-only states, ever. Queue position, elapsed time, staged copy, blur-up reveal. |
| **Thumb-first** | Every primary action on mobile sits in the bottom third. Nothing critical hides behind hover. |
| **Ask for the key last** | A visitor can browse, pick a look, and compose a full prompt before we mention a key. The ask lands at the moment of demonstrated intent. |

### Non-goals (v1)
Accounts, payments, teams, node/graph editors, real-time paint canvas, in-app video timeline editing, training/fine-tuning, model comparison arenas.

### Success criteria
- Landing → first generation started: **≤ 3 interactions** after key entry.
- LCP < 2.0s on 4G mobile; interaction latency < 100ms on the studio surface.
- Zero orphaned jobs: every submitted job reaches a terminal state, webhook or no webhook.
- The key never appears in a log line, an error payload, a client bundle, or a database column in plaintext.
- Lighthouse ≥ 95 across Performance / Accessibility / Best Practices on both mobile and desktop.

---

## Part 2 — Architecture

```
Browser (Next.js RSC + client islands)
   │  httpOnly signed session cookie
   ▼
Next.js Route Handlers  ──────────────┐
   │                                  │
   ├─ /api/session/key   → Key Vault (AES-256-GCM, MASTER_KEY in env)
   ├─ /api/jobs          → Generation Core → fal queue.submit(?fal_webhook=…)
   ├─ /api/jobs/[id]/stream (SSE)         │
   ├─ /api/webhooks/fal  ← ED25519-verified callback from fal
   └─ /api/internal/sweep ← cron reconciler (the safety net)
                                          │
   Postgres (Drizzle)  ◄─────────────────┘
   sessions · jobs · assets · job_events · shares
                                          │
   R2 / S3  ◄── asset ingest (fal URLs are ephemeral; we re-host)
```

**Load-bearing choices, and why:**

- **Server proxy, not browser→fal directly.** The key leaves the browser once, at entry. Every subsequent call is ours, so we can validate params, attach our webhook, and record the job. Note: `@fal-ai/server-proxy`'s stock handler reads `FAL_KEY` from env — we need a custom route handler that resolves the key from the session instead.
- **Webhook *and* poller.** fal retries a failed webhook up to ~31 times over an hour, but drops deliveries to private IPs permanently and does not follow redirects. A webhook-only design loses jobs. The sweeper polls `…/requests/{id}/status` for any non-terminal job past its backoff. Both paths converge on the same idempotent transition function.
- **Key must be at rest server-side, not cookie-only.** The webhook handler and sweeper need to act on a job with no user request in flight — for status polls and for ingesting results. So: ciphertext in Postgres, session id in the cookie. This is a real tradeoff and is documented as such.
- **No Redis.** SSE reads job state from Postgres on a short server-side interval. Fewer moving parts; SSE duration limits on serverless are handled by a client that reconnects and falls back to polling with backoff.
- **We re-host every asset.** fal result URLs expire. The library is worthless if yesterday's images 404.

### Job state machine
```
draft → submitting → queued → running → ingesting → ready
                 ↘         ↘        ↘         ↘
                   failed · canceled · expired
```
One pure `transition(job, event) → job | error` function. Illegal transitions throw. Every transition appends to `job_events`. Webhook, sweeper, and cancel all call it — nothing mutates `jobs.status` directly.

---

## Part 3 — Agent Checklists

Fourteen specialized agents in four waves. Wave 0 blocks everything. Within a wave, agents run in parallel against the contracts Wave 0 froze.

> **Rules for every agent:** work on `claude/ai-photo-video-site-plan-ruxvfx`. Do not edit files owned by another agent — if you need a change there, note it in `docs/handoffs/<your-id>.md`. Every agent leaves its surface typechecking, linting, and tested before reporting done.

---

### Wave 0 — Foundation *(blocking, run alone)*

#### `AGENT-00` — Foundation & Contracts
**Mission:** stand up the skeleton and freeze the interfaces every other agent codes against.

- [ ] Scaffold Next.js App Router + TypeScript strict, `src/` layout, path aliases.
- [ ] Tooling: ESLint (flat), Prettier, Vitest, Playwright (use preinstalled Chromium at `/opt/pw-browsers`; do **not** run `playwright install`).
- [ ] Postgres + Drizzle: connection, migration scripts, `pnpm db:push` / `db:studio`.
- [ ] Author `src/lib/contracts/` — the frozen types: `Job`, `JobStatus`, `JobEvent`, `Asset`, `ModelDescriptor`, `GenerationParams`, `ApiResult<T>`. **These are the API between agents.**
- [ ] Zod schemas for every contract type + a shared `parseOrThrow` helper.
- [ ] Env contract in `src/lib/env.ts` — Zod-validated, fails fast at boot. Keys: `DATABASE_URL`, `MASTER_KEY`, `SESSION_SECRET`, `PUBLIC_URL`, `R2_*`, `FAL_MODE`.
- [ ] **Mock mode:** `FAL_MODE=mock` makes the provider adapter return fixture assets on a realistic delay curve. Every test and every CI run uses it. Nothing spends money.
- [ ] `docs/ARCHITECTURE.md` (this plan's Part 2, expanded) and `docs/handoffs/` directory.
- [ ] GitHub Actions: typecheck → lint → unit → build → e2e, on push to the branch.
- [ ] `.env.example`, and a `.gitignore` that covers `.env*`, `node_modules`, `.next`.

**Done when:** `pnpm dev` serves a placeholder page, `pnpm test` and `pnpm build` pass in CI, and the contracts file is committed and announced.

---

### Wave 1 — Core Systems *(parallel)*

#### `AGENT-01` — Design System ("the look")
**Mission:** the dark cinematic language, as reusable primitives. This agent's output determines whether the product reads as premium.

- [ ] Token layer in CSS custom properties: surfaces `#08080A → #141418`, a single accent, 8pt spacing scale, radii, elevation via *tinted* shadow + 1px hairline borders (never gray-on-gray).
- [ ] Type scale: one display face for headings/hero (Google Fonts, with a real fallback stack), one high-legibility UI face. Tabular numerals for timers/counters.
- [ ] Motion language: durations (120/200/320/500ms), one shared easing curve, and the three signature moves — **blur-up reveal** for arriving media, **shimmer-skeleton** for pending tiles, **spring press** for the primary button. Everything respects `prefers-reduced-motion`.
- [ ] Primitives: `Button` (primary/ghost/danger, loading + disabled-with-reason), `Field`, `Sheet` (bottom on mobile, side on desktop), `Chip`, `Tabs`, `Tooltip`, `Toast`, `Dialog`, `Skeleton`, `Progress`, `EmptyState`, `ErrorState`.
- [ ] Media primitives: `MediaTile` (aspect-locked, blur-up, video hover-preview with poster fallback), `MediaLightbox` (swipe-dismiss on touch, arrow-key nav on desktop).
- [ ] Focus-visible rings that survive the dark palette. Contrast ≥ 4.5:1 for all text, verified not assumed.
- [ ] A `/dev/kitchen-sink` route rendering every primitive in every state.

**Done when:** kitchen sink covers every state, axe reports zero violations on it, and no other agent needs to write raw CSS colors.

---

#### `AGENT-02` — Model Registry
**Mission:** turn 600+ fal models into a curated menu of *looks*. This is the "hide the model, sell the look" principle made concrete.

- [ ] `src/lib/models/registry.ts` — a typed `ModelDescriptor[]`, code not DB.
- [ ] Per entry: `id` (fal endpoint), `look` (user-facing name), `blurb`, `kind: image|video`, `tier: fast|balanced|max`, `params` (Zod schema), `defaults`, `aspectRatios`, `estSeconds`, `estCostUsd`, `supports: {imageInput, refImages, audio, duration, seed, negativePrompt}`, `sampleAssetKey`.
- [ ] Curate a tight image roster across tiers — the FLUX.2 family as the balanced default, a Nano Banana Pro / Seedream 4.5 / GPT Image class entry for max quality, a fast/cheap draft model. **Verify every endpoint ID against fal's live catalog before committing it.**
- [ ] Curate a tight video roster — Veo 3.1 (native audio, 4K), Kling 3.0 (cinematic motion), Seedance, plus a fast draft-tier model.
- [ ] `resolveLook(lookId) → ModelDescriptor` and `validateParams(descriptor, input)` — the only ways the rest of the app touches models.
- [ ] Cross-model param normalization: one `GenerationParams` shape in, model-specific payload out. Adapters live here, not in the UI.
- [ ] Curated **prompt starters** per look (6–10 each), written to actually look good with that model.
- [ ] Sample assets for every look, committed and optimized — these are what the picker shows.
- [ ] Unit tests: every descriptor's schema round-trips its defaults; every `sampleAssetKey` resolves.

**Done when:** the registry is the single source of truth and adding a model is a one-file change.

---

#### `AGENT-03` — Key Vault & Session Security
**Mission:** hold someone else's API key without ever being the reason it leaks. Treat this checklist as a security boundary, not a feature.

- [ ] `sessions` table: `id`, `created_at`, `last_seen_at`, `key_ciphertext`, `key_nonce`, `key_fingerprint`, `key_verified_at`, `key_expires_at`.
- [ ] Signed, `httpOnly`, `Secure`, `SameSite=Lax` session cookie. Rotate id on key change.
- [ ] AES-256-GCM encrypt/decrypt in `src/lib/vault.ts`, keyed by `MASTER_KEY`. Fresh nonce per write. **Only this module ever holds plaintext, and it never returns it to a caller outside the provider adapter.**
- [ ] `POST /api/session/key` — validate format, verify the key with one cheap live fal call, store ciphertext, return **only** the fingerprint (`key_…abcd`). Reject an unverified key.
- [ ] `DELETE /api/session/key` — "Forget my key": null the columns, clear the cookie, confirm in UI.
- [ ] Auto-expire keys after 30 days idle; sweeper purges expired rows.
- [ ] **Log redaction middleware** — a serializer that scrubs anything matching the fal key shape from every log, error, and toast payload. Ship a test that logs an object containing a key and asserts it is absent from the sink.
- [ ] Rate-limit key-entry attempts per IP (in-Postgres counter, no Redis).
- [ ] Assert in CI that `key_ciphertext` never crosses a serialization boundary: a test that JSON-serializes every API response type and greps for the field.
- [ ] `docs/SECURITY.md` — the threat model, what we store, what we can and cannot see, and the honest statement that a server compromise exposes keys.

**Done when:** the security tests pass and a grep for the key variable name shows it confined to `vault.ts` and the adapter.

---

#### `AGENT-04` — Generation Core
**Mission:** the job lifecycle. The "rock solid" requirement lives or dies here.

- [ ] Schema: `jobs` (id, session_id, kind, look_id, model_id, params jsonb, status, fal_request_id, fal_status, error_code, error_message, attempt, idempotency_key, submitted_at, started_at, completed_at, last_polled_at, next_poll_at) and `job_events` (job_id, at, from_status, to_status, source, data jsonb).
- [ ] Indexes: `(session_id, created_at desc)`, `(status, next_poll_at)`, unique `(session_id, idempotency_key)`.
- [ ] `src/lib/jobs/machine.ts` — the pure `transition()` function. Illegal transitions throw a typed error. **No other module writes `jobs.status`.** Exhaustive unit tests over the full transition matrix, legal and illegal.
- [ ] `src/lib/provider/` — the adapter interface (`submit`, `status`, `result`, `cancel`) with a `fal` implementation and a `mock` implementation selected by `FAL_MODE`.
- [ ] fal submit: `POST https://queue.fal.run/{model-id}` with `Authorization: Key <decrypted>` and `?fal_webhook=<PUBLIC_URL>/api/webhooks/fal`. Persist `request_id` **before** returning to the client.
- [ ] `POST /api/jobs` — validate against the registry schema, enforce idempotency key, create job, submit, return job id. Reject if no verified key on session.
- [ ] `GET /api/jobs/[id]` and `GET /api/jobs` (session-scoped, cursor-paginated). 404 — never 403 — for another session's job.
- [ ] `POST /api/jobs/[id]/cancel` → fal `cancel_url`, then `canceled`.
- [ ] `POST /api/webhooks/fal` — **full ED25519 verification before any parsing**: reject timestamps outside ±300s; rebuild the message as request-id \n user-id \n timestamp \n SHA-256(raw body) joined by newlines; verify against JWKS from `https://rest.fal.ai/.well-known/jwks.json`, cached ≤24h; accept if any key validates. Idempotent on `request_id`. Always return 2xx once verified. Never redirect.
- [ ] `GET /api/internal/sweep` — the reconciler. Claims due jobs (`status` non-terminal AND `next_poll_at <= now`) with `SELECT … FOR UPDATE SKIP LOCKED`, polls fal status, transitions, sets exponential `next_poll_at` (2s → 5s → 15s → 60s, cap 5m). Marks `expired` past a hard ceiling (10m image / 20m video). Cron-triggered; protected by a shared secret.
- [ ] Error taxonomy: `INVALID_KEY`, `INSUFFICIENT_CREDIT`, `RATE_LIMITED`, `CONTENT_REJECTED`, `MODEL_ERROR`, `TIMEOUT`, `NETWORK` — each mapped to user-facing copy and exactly one recovery action.
- [ ] Integration test: submit → webhook arrives → `ready`. And: submit → webhook **never** arrives → sweeper drives it to `ready`. Both must pass.

**Done when:** no code path can leave a job non-terminal, and the two integration tests above are green.

---

#### `AGENT-05` — Asset Pipeline
**Mission:** results that still load next month, and thumbnails that make the grid feel instant.

- [ ] `assets` table: id, job_id, session_id, kind, storage_key, poster_key, mime, width, height, duration_ms, bytes, checksum, source_url, ingested_at.
- [ ] Ingest on `ready`: stream from the fal URL to R2 with a size ceiling and content-type allowlist. Never buffer a whole video in memory. Retry with backoff; failure transitions the job to `failed` with `INGEST_FAILED`.
- [ ] Derivatives: blur placeholder (tiny base64 for instant paint), grid thumbnail (WebP/AVIF), and for video a poster frame + a short muted preview loop.
- [ ] Signed, short-TTL read URLs; a `/api/assets/[id]` redirect handler so the DOM never carries a raw bucket URL.
- [ ] Download endpoint with `Content-Disposition` and a sensible filename (`thunkin-<look>-<date>.<ext>`).
- [ ] Storage lifecycle: assets tied to a session expire with it; a purge path the sweeper calls.
- [ ] `next/image` config wired to the asset host, correct `sizes` on every consumer.
- [ ] Tests: ingest happy path, oversize rejection, wrong-mime rejection, expired-source handling.

**Done when:** a job's output survives fal's URL expiry and the grid paints placeholders before bytes arrive.

---

### Wave 2 — Experience *(parallel, depends on Wave 1)*

#### `AGENT-06` — The Studio
**Mission:** the create surface. This is the product. Judged on whether the core loop actually takes three decisions.

- [ ] Route `/` — hero that is a **live wall of generated output**, not a marketing block. One call to action.
- [ ] Route `/studio` — the surface. Desktop: look-picker rail · composer center · results pane right. Mobile: full-bleed results with a composer bottom sheet.
- [ ] **Look picker** — visual cards using registry sample assets. Never a text dropdown. Image/Video segmented control.
- [ ] **Composer** — one prompt field, autosize, prompt-starter chips from the registry, aspect-ratio picker as shapes (not labels), and a single `Advanced` disclosure holding seed / negative prompt / steps / duration / model ID.
- [ ] **Primary action** — one button, states: ready · submitting · disabled-with-reason. Presses feel instant: optimistic pending tile inserted before the response lands.
- [ ] **Pending tile** — occupies the exact final aspect ratio, shimmer skeleton, honest elapsed timer, queue position when known, cancel affordance. Never a bare spinner.
- [ ] **Result reveal** — blur-up from placeholder, subtle scale settle. Video autoplays muted inline with poster fallback.
- [ ] **Per-result actions** — Download · Share · Regenerate (same seed) · Vary (new seed) · Use as input · Delete. On mobile these live in a bottom sheet on long-press.
- [ ] Draft persistence: prompt and settings survive refresh (localStorage, try/catch guarded).
- [ ] Keyboard: `⌘/Ctrl+Enter` generate, `Esc` close, `←/→` navigate results.
- [ ] Every error state renders `ErrorState` with the taxonomy copy and its one recovery action.

**Done when:** landing → generating is three interactions post-key, and every state in the loop has a designed appearance.

---

#### `AGENT-07` — Realtime & Progress
**Mission:** make a three-minute wait feel supervised rather than abandoned.

- [ ] `GET /api/jobs/[id]/stream` — SSE, server-side polls job state on a short interval, emits status + queue position + elapsed, heartbeats to survive proxies, closes on terminal state.
- [ ] Client `useJobStream` hook: EventSource with reconnect-and-backoff, automatic fallback to interval polling when SSE dies (serverless duration limits are expected, not exceptional).
- [ ] Multi-job awareness: several jobs in flight at once, each with independent progress, all reconciled into one results list.
- [ ] **Resume on return** — reopening the tab rehydrates in-flight jobs from the server. Closing the laptop does not lose work.
- [ ] Staged waiting copy tied to real status (`queued` → `running` → `finishing`), never fake percentages.
- [ ] Completion feedback: toast if the tab is backgrounded, title-bar badge, optional `Notification` API ping behind an explicit opt-in.
- [ ] Tests: stream emits the full transition sequence; killing the stream mid-job still lands the client on `ready`.

**Done when:** a job completes correctly whether the user watches, switches tabs, or reloads mid-flight.

---

#### `AGENT-08` — Library, Compare & Share
**Mission:** the payoff surface — where output accumulates and leaves the app.

- [ ] Route `/library` — responsive masonry, newest first, cursor-paginated infinite scroll, `content-visibility` for long lists.
- [ ] Filters: image/video, look, date. Client-side over a fetched window; no filter UI that returns nothing without saying so.
- [ ] Lightbox: full metadata (prompt, look, seed, dimensions, duration), copy-prompt, one-tap re-run into the studio.
- [ ] **Compare** — select 2–4 results into a side-by-side (desktop) or swipe-stack (mobile) view. This is the feature that makes iteration feel good; keep it lightweight.
- [ ] Share: `shares` table with slug, `expires_at`, `revoked`. `POST /api/share` mints a link; `/s/[slug]` is a public, OG-tagged, no-chrome view of one asset. Revoke from the library.
- [ ] OG/Twitter meta on share pages generated from the asset (poster frame for video) so links preview properly.
- [ ] Bulk select → download as zip; bulk delete with undo toast.
- [ ] Empty state that sells the product rather than apologizing — showcase reel plus one CTA.

**Done when:** results are findable, comparable, and shareable, and a share link renders correctly when pasted into a chat app.

---

#### `AGENT-09` — Mobile Experience & First Run
**Mission:** the two things most likely to sink this — phone ergonomics, and the BYOK ask. One agent owns both because they collide on the same first-run screen.

- [ ] Server-side device hint via `userAgent()` from `next/headers` to select the shell variant during SSR — no post-hydration layout flash. Breakpoints and container queries handle everything below that.
- [ ] Mobile shell: bottom tab bar (Create · Library), bottom-sheet composer with snap points, safe-area insets honored, `100dvh` not `100vh`.
- [ ] Touch: swipe between results, long-press for actions, pull-to-refresh on library, 44px minimum hit targets, no hover-dependent affordance anywhere.
- [ ] iOS specifics: `playsInline` on all video, no input zoom (≥16px font on fields), momentum scroll containment inside sheets.
- [ ] **Key onboarding — the critical path.** A visitor may browse looks and compose a full prompt *before* being asked for anything. On the first `Generate`, a sheet explains in two sentences why a key is needed, links to fal's key page, and takes the paste. Success animates straight into the pending tile — **the generation they asked for starts immediately**, no re-navigation, no re-entry of the prompt.
- [ ] Key state UI: fingerprint chip in the header, one-tap "Forget key," and a clear inline recovery when a key goes invalid mid-session.
- [ ] Guided first generation: a preselected look and a prompt starter already filled, so `Generate` is genuinely one tap for a first-timer.
- [ ] Web app manifest, maskable icons, themed status bar. (Service worker is out of scope for v1.)
- [ ] Verify on real viewport sizes with Playwright device emulation: iPhone SE (small), iPhone 15 Pro, Pixel 8, iPad.

**Done when:** the whole loop is comfortable one-handed, and a first-time visitor's key entry costs them nothing they'd already typed.

---

### Wave 3 — Hardening *(parallel, after Wave 2)*

#### `AGENT-10` — Safety & Trust
- [ ] Client + server prompt screening against a maintained blocklist, focused on CSAM, real-person sexual content, and named-individual impersonation. Server-side is authoritative.
- [ ] Map fal's own content rejections to `CONTENT_REJECTED` with non-accusatory, actionable copy.
- [ ] Preserve C2PA/provenance metadata where the model emits it; never strip it during ingest.
- [ ] Report/remove control on share pages, and immediate revocation path.
- [ ] `/terms`, `/privacy`, `/acceptable-use` — plain-language, honest about key handling and asset retention.
- [ ] First-run disclosure that generation happens on the user's own fal account under fal's terms.

#### `AGENT-11` — Performance & Accessibility
- [ ] Bundle budgets in CI (fail the build on regression); route-level code splitting; RSC by default with client islands only where interaction demands it.
- [ ] `next/font` self-hosting, preconnect, no layout shift from font swap.
- [ ] Image/video: correct `sizes`, `priority` only on the hero, lazy everything below the fold, `preload="metadata"` on video.
- [ ] Full keyboard traversal of every surface; focus trapping in sheets and dialogs; focus restoration on close.
- [ ] Screen reader pass: live regions announce job status changes; media has meaningful labels; landmark structure is correct.
- [ ] `prefers-reduced-motion` honored by every signature motion.
- [ ] Lighthouse CI ≥ 95 on all four categories, mobile and desktop, enforced in the pipeline.

#### `AGENT-12` — Observability & Ops
- [ ] Structured request logging with a correlation id, routed through the vault's redaction serializer.
- [ ] `/api/health` — DB, storage, and fal reachability, with a degraded (not failing) response shape.
- [ ] Job metrics: submitted / completed / failed / expired, p50 & p95 duration by model, webhook-vs-sweeper resolution ratio. **A rising sweeper ratio is the early warning that webhooks are broken.**
- [ ] Error boundaries per route segment with recovery UI, wired to an error reporter with PII scrubbing.
- [ ] Cron configuration for the sweeper (~every 60s) plus a documented manual trigger.
- [ ] `docs/RUNBOOK.md`: stuck jobs, webhook outage, storage full, invalid-key spike, rollback.

#### `AGENT-13` — Documentation & DX
- [ ] `README.md`: what it is, a screenshot, quickstart, env setup, `FAL_MODE=mock` for zero-cost development.
- [ ] `docs/ADDING_A_MODEL.md` — the one-file registry change, end to end.
- [ ] `docs/API.md` — every route, its contract, and its error codes.
- [ ] `CONTRIBUTING.md` with the agent-ownership map from this plan.
- [ ] Seed script populating a demo library from fixtures so `/library` is never empty in development.
- [ ] `.claude/skills/run/SKILL.md` so future sessions know how to boot and drive the app.

---

## Part 4 — Sequencing

```
Wave 0:  AGENT-00 ──────────────────────────────────────── (blocking)
                │
Wave 1:  ┌──────┼──────┬──────────┬──────────┐
         01     02     03         04         05          (parallel)
      design  models  vault   gen-core    assets
         │      │      │          │          │
Wave 2:  └──────┴──┬───┴────┬─────┴────┬─────┘
                   06       07        08        09        (parallel)
                studio   realtime  library    mobile
                   │        │         │         │
Wave 3:  ──────────┴────────┴─────────┴─────────┴──
                   10       11        12        13        (parallel)
                 safety   perf/a11y   ops      docs
```

**Critical path:** `00 → 04 → 06 → 07`. Everything else can slip a little without moving the ship date.

**The two riskiest checklists,** worth front-loading review on:
1. `AGENT-04`'s webhook-plus-sweeper convergence — it is the whole "rock solid" claim.
2. `AGENT-09`'s key-onboarding moment — it is where "a few buttons" is won or lost.

---

## Part 5 — Verification

**Local:**
```bash
pnpm install
cp .env.example .env.local     # FAL_MODE=mock needs no real key
pnpm db:push && pnpm db:seed
pnpm dev
```

**Automated:**
```bash
pnpm typecheck && pnpm lint
pnpm test                      # unit: state machine, vault, registry, webhook signature
pnpm test:e2e                  # Playwright, mock provider, four device profiles
pnpm lighthouse                # budgets enforced
```

**Must-pass scenarios** (each is an owned, named test):
1. Cold visitor → pick look → prompt → Generate → key sheet → paste → the *original* request runs → image appears. No step repeated.
2. Video job submitted, webhook suppressed → sweeper drives it to `ready` within its backoff window.
3. Webhook replayed three times → exactly one state transition, one asset.
4. Webhook with a bad signature, and one with a 6-minute-old timestamp → both rejected, nothing mutated.
5. Tab closed mid-job, reopened → job rehydrates and completes.
6. Invalid key mid-session → clear inline recovery, prior results untouched.
7. Full loop on iPhone SE viewport, one-handed, no horizontal scroll anywhere.
8. Key value greppable in **no** log, response body, or client bundle — asserted by test, not by inspection.

**Live smoke** (once, with a real key, before calling it done): one image and one video against real fal endpoints, confirming registry IDs are current and the webhook reaches the deployed public URL.

---

## Open items to revisit after Wave 1

- **Model IDs drift.** `AGENT-02` must verify every endpoint against fal's live catalog at implementation time; the IDs named in Part 1 are directionally right as of Aug 2026, not authoritative. (Note: Sora 2's API shuts down 2026-09-24 — do not add it.)
- **BYOK friction is the top product risk.** If first-run drop-off is bad, the fallback is a server-key demo tier with a hard daily ceiling. Keep the provider adapter's key resolution pluggable so that stays a small change.
- **SSE on serverless** may prove unreliable enough that polling becomes the primary path. `AGENT-07`'s fallback must be good enough to ship on its own.
