import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db, type Db } from "@/lib/db";
import { jobEvents, jobs, type JobRow } from "@/lib/db/tables/jobs";
import type { GenerationParams, Job, JobKind, JobStatus } from "@/lib/contracts";
import { TERMINAL_STATUSES } from "@/lib/contracts";
import { transition, type JobEventInput, type TransitionSource } from "./machine";
import { nextPollAt } from "./backoff";

/**
 * All database access for jobs.
 *
 * `applyTransition` is the only function in the codebase that writes
 * `jobs.status`, and it always writes the matching `job_events` row in the same
 * transaction. If those two ever diverge, the audit trail stops being evidence.
 */

/** Row shape to domain shape. Drizzle gives us the columns; this gives meaning. */
function toJob(row: JobRow): Job {
  return {
    id: row.id,
    sessionId: row.sessionId,
    kind: row.kind,
    lookId: row.lookId,
    modelId: row.modelId,
    params: row.params,
    status: row.status,
    falRequestId: row.falRequestId,
    queuePosition: row.queuePosition,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    attempt: row.attempt,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    nextPollAt: row.nextPollAt,
  };
}

export interface CreateJobInput {
  sessionId: string;
  kind: JobKind;
  lookId: string;
  modelId: string;
  params: GenerationParams;
  idempotencyKey: string;
}

/**
 * Creates a job, or returns the existing one for a repeated idempotency key.
 *
 * The unique index does the real work: two concurrent submits from a
 * double-tapped button both reach the database, one wins, and the loser reads
 * back the winner's row instead of erroring.
 */
export async function createJob(
  input: CreateJobInput,
  client: Db = db,
): Promise<{ job: Job; created: boolean }> {
  const row: typeof jobs.$inferInsert = {
    id: `job_${randomUUID()}`,
    sessionId: input.sessionId,
    kind: input.kind,
    lookId: input.lookId,
    modelId: input.modelId,
    params: input.params,
    status: "draft" satisfies JobStatus,
    attempt: 0,
    idempotencyKey: input.idempotencyKey,
  };

  const inserted = await client
    .insert(jobs)
    .values(row)
    .onConflictDoNothing({
      target: [jobs.sessionId, jobs.idempotencyKey],
    })
    .returning();

  const first = inserted[0];
  if (first) return { job: toJob(first), created: true };

  const existing = await client
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.sessionId, input.sessionId),
        eq(jobs.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  const found = existing[0];
  if (!found) {
    // The insert reported a conflict but the conflicting row is gone. That is a
    // real inconsistency, not something to paper over with a retry loop.
    throw new Error(
      `Idempotency conflict for ${input.idempotencyKey} but no existing job found.`,
    );
  }

  return { job: toJob(found), created: false };
}

/**
 * One job.
 *
 * Not scoped by session, deliberately. This is a single-user service behind a
 * passphrase: an unlocked caller *is* the owner, and their phone and their
 * laptop hold different session cookies. Scoping here would mean each device
 * saw a different library, which is a bug rather than a boundary.
 *
 * `sessionId` is accepted and ignored so callers stay unchanged and the seam
 * is obvious if this ever becomes multi-user again.
 */
export async function getJob(
  jobId: string,
  _sessionId: string,
  client: Db = db,
): Promise<Job | null> {
  const rows = await client.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

  return rows[0] ? toJob(rows[0]) : null;
}

/** Unscoped lookup for the webhook, which arrives with no session context. */
export async function getJobByRequestId(
  falRequestId: string,
  client: Db = db,
): Promise<Job | null> {
  const rows = await client
    .select()
    .from(jobs)
    .where(eq(jobs.falRequestId, falRequestId))
    .limit(1);

  return rows[0] ? toJob(rows[0]) : null;
}

/**
 * The library — every job, newest first.
 *
 * Unscoped for the same reason as `getJob`: one owner, many devices, one
 * library.
 */
export async function listJobs(
  _sessionId: string,
  options: { limit?: number; before?: Date } = {},
  client: Db = db,
): Promise<Job[]> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);

  const rows = options.before
    ? await client
        .select()
        .from(jobs)
        .where(lte(jobs.createdAt, options.before))
        .orderBy(desc(jobs.createdAt))
        .limit(limit)
    : await client.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit);

  return rows.map(toJob);
}

export interface TransitionOutcome {
  job: Job;
  /** False when the event was absorbed as a no-op. */
  changed: boolean;
}

/**
 * Applies an event to a job and persists the outcome.
 *
 * **The only writer of `jobs.status` in the codebase.** The job row and its
 * event row are written in one transaction so the audit trail can never lag
 * the state it describes.
 */
/**
 * Every job column a transition may write, besides `status`.
 *
 * Exported so the machine's tests can assert that no event produces a patch
 * key outside this list — the previous hand-enumerated `if`s would silently
 * drop a newly added field, which is exactly the failure a `Partial` cannot
 * surface at compile time.
 */
export const PATCH_FIELDS = [
  "submittedAt",
  "startedAt",
  "completedAt",
  "falRequestId",
  "queuePosition",
  "errorCode",
  "errorMessage",
  "nextPollAt",
] as const satisfies readonly (keyof Job)[];

export async function applyTransition(
  jobId: string,
  event: JobEventInput,
  source: TransitionSource,
  client: Db = db,
  now: Date = new Date(),
): Promise<TransitionOutcome> {
  return client.transaction(async (tx) => {
    /*
     * Lock the row for the duration. Without this, a webhook and a sweeper
     * reading the same job concurrently would both compute a transition from
     * the same stale status and both write — producing two event rows for one
     * real change.
     */
    const locked = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for("update")
      .limit(1);

    const row = locked[0];
    if (!row) throw new Error(`No such job: ${jobId}`);

    const current = toJob(row);
    const result = transition(current, event, now);

    // Absorbed: the other path got here first, which is normal and expected.
    if (result === null) return { job: current, changed: false };

    const patch: Partial<typeof jobs.$inferInsert> = { status: result.toStatus };

    for (const field of PATCH_FIELDS) {
      if (field in result.patch) {
        // The two sides agree column-for-column; the loop just cannot say so.
        (patch as Record<string, unknown>)[field] = result.patch[field];
      }
    }

    const updated = await tx
      .update(jobs)
      .set(patch)
      .where(eq(jobs.id, jobId))
      .returning();

    await tx.insert(jobEvents).values({
      id: `evt_${randomUUID()}`,
      jobId,
      at: now,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      source,
      data: result.data,
    });

    return { job: toJob(updated[0]!), changed: true };
  });
}

/** Schedules the next sweeper visit and bumps the poll counter. */
export async function schedulePoll(
  jobId: string,
  attempt: number,
  client: Db = db,
  now: Date = new Date(),
): Promise<void> {
  await client
    .update(jobs)
    .set({ attempt, nextPollAt: nextPollAt(attempt, now) })
    .where(eq(jobs.id, jobId));
}

/**
 * Claims jobs that are due for a poll.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes overlapping sweeps safe: a second
 * sweeper running concurrently steps over the rows the first already holds
 * rather than blocking on them or double-processing them. Cron overlap and the
 * opportunistic piggyback sweep both depend on this.
 */
export async function claimDueJobs(
  limit: number,
  client: Db = db,
  now: Date = new Date(),
): Promise<Job[]> {
  return client.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(jobs)
      .where(
        and(
          notInArray(jobs.status, [...TERMINAL_STATUSES]),
          isNotNull(jobs.falRequestId),
          or(isNull(jobs.nextPollAt), lte(jobs.nextPollAt, now)),
        ),
      )
      // Postgres sorts NULLs last under plain ASC, which would serve the
      // never-scheduled — i.e. maximally overdue — jobs after everything else.
      .orderBy(sql`${jobs.nextPollAt} asc nulls first`)
      .limit(limit)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];

    /*
     * Push the next poll out immediately, inside the same transaction. The
     * claim is only meaningful while the lock is held; without this a sweeper
     * that crashes mid-poll would leave the job instantly re-claimable and a
     * fast cron could hammer it.
     */
    await tx
      .update(jobs)
      .set({ nextPollAt: nextPollAt(0, now) })
      .where(
        inArray(
          jobs.id,
          rows.map((row) => row.id),
        ),
      );

    return rows.map(toJob);
  });
}

/**
 * Non-terminal jobs with no provider request id, oldest first.
 *
 * These are the orphans: a crash between creating the row and the provider
 * accepting it leaves a job the claim query can never see (it filters on
 * `falRequestId` being present), so without this second path such a job would
 * sit "in flight" forever. The sweeper expires the ones past their ceiling.
 */
export async function findOrphanedJobs(limit: number, client: Db = db): Promise<Job[]> {
  const rows = await client
    .select()
    .from(jobs)
    .where(
      and(notInArray(jobs.status, [...TERMINAL_STATUSES]), isNull(jobs.falRequestId)),
    )
    .orderBy(asc(jobs.createdAt))
    .limit(limit);

  return rows.map(toJob);
}

/** The audit trail for one job, oldest first. */
export async function listJobEvents(jobId: string, client: Db = db) {
  return client
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(asc(jobEvents.at));
}
