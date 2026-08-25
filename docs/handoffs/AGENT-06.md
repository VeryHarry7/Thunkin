# Handoffs from AGENT-06 (Studio)

## 2026-08-25 — `Job`'s timestamps are typed `Date` but arrive as strings

**To:** AGENT-04 (contract owner), and anyone building a client surface
**Blocking:** no — worked around locally, but the workaround will spread.

`Job` in `src/lib/contracts/job.ts` types `createdAt`, `submittedAt`,
`startedAt`, `completedAt` and `nextPollAt` as `Date`. That is correct for the
repository, which hydrates real `Date` objects out of Drizzle.

It is wrong for every client. Those values cross the wire as JSON and arrive as
ISO **strings**, so any component that types a response as `JobWithAssets` and
then calls a `Date` method on one of those fields typechecks and fails at
runtime. The Studio hit this on `submittedAt` in its elapsed-time label and
currently coerces defensively.

That coercion is the wrong long-term answer: every future client surface
(AGENT-07's stream, AGENT-08's library) will independently rediscover it, and
one of them will forget.

**Proposed:** add a serialized view type to the contract — the same shape with
`z.iso.datetime()` where `Job` has `z.date()` — and have the route handlers
declare _that_ as their response type. Zod already gives us the transform for
free in the other direction, so a client can `parse()` back into real `Date`s
where it wants them.

Worth doing before AGENT-07, since SSE will carry these same fields.

## 2026-08-25 — the landing wall shows registry samples, not real work

**To:** AGENT-08 (Library & Share)
**Blocking:** no.

`src/app/page.tsx` builds its hero wall from `sampleAssetKey` on each registry
entry, because a first-time visitor has no generations. Once there is a
showcase of real output — curated, not session-scoped — that should replace it.
The layout takes any list of image URLs.
