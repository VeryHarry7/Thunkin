import type { JobKind } from "@/lib/contracts";

/**
 * When the sweeper should look at a job again, and when it should give up.
 *
 * Pure functions with no clock of their own — `now` is always passed in — so
 * the schedule is testable without waiting for real time to pass.
 */

/**
 * Poll delays by attempt, in milliseconds.
 *
 * Tight at the start because most images finish inside the first few seconds
 * and a visitor is watching; loosening quickly after that because a job still
 * running at a minute is not about to finish in the next two.
 */
const SCHEDULE_MS = [2_000, 5_000, 15_000, 60_000] as const;

/** Nothing is polled less often than this. */
export const MAX_POLL_INTERVAL_MS = 300_000;

/**
 * How long a job may stay in flight before it is declared expired.
 *
 * Generous relative to the models' own estimates: expiring a job that would
 * have succeeded is worse than making someone wait. Video gets double.
 */
export const EXPIRY_CEILING_MS: Record<JobKind, number> = {
  image: 600_000,
  video: 1_200_000,
};

/** The delay before poll number `attempt` (0-based). */
export function pollDelayMs(attempt: number): number {
  if (attempt < 0) return SCHEDULE_MS[0];
  return attempt < SCHEDULE_MS.length ? SCHEDULE_MS[attempt]! : MAX_POLL_INTERVAL_MS;
}

/** The absolute time of the next poll. */
export function nextPollAt(attempt: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + pollDelayMs(attempt));
}

/**
 * Whether a job has outlived its ceiling.
 *
 * Measured from submission rather than creation: time a job spent as a local
 * draft is not the provider's fault and should not count against it.
 */
export function hasExpired(
  job: { kind: JobKind; submittedAt: Date | null; createdAt: Date },
  now: Date = new Date(),
): boolean {
  const start = job.submittedAt ?? job.createdAt;
  return now.getTime() - start.getTime() > EXPIRY_CEILING_MS[job.kind];
}
