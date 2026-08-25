import { claimDueJobs } from "./repo";
import { advanceJob } from "./service";
import { isTerminal } from "@/lib/contracts";

/**
 * The reconciler — the reason "zero orphaned jobs" is true.
 *
 * fal drops webhook deliveries to private IPs permanently and does not follow
 * redirects, so a webhook-only design loses jobs silently and only in
 * production. This sweep is the independent second path: it polls anything
 * non-terminal that is due, and it does not care whether a webhook ever came.
 */

export interface SweepResult {
  claimed: number;
  advanced: number;
  settled: number;
  errors: number;
}

/** How many jobs one sweep handles. Bounded so a serverless run cannot time out. */
const DEFAULT_BATCH = 25;

export async function sweep(
  options: { limit?: number; now?: Date } = {},
): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const jobs = await claimDueJobs(options.limit ?? DEFAULT_BATCH, undefined, now);

  const result: SweepResult = {
    claimed: jobs.length,
    advanced: 0,
    settled: 0,
    errors: 0,
  };

  /*
   * Sequential on purpose. Each job is an outbound provider call on someone
   * else's rate limit, and a burst of parallel requests is the fastest way to
   * turn a healthy sweep into a wave of 429s.
   */
  for (const job of jobs) {
    try {
      const advanced = await advanceJob(job, "sweeper");
      if (advanced.status !== job.status) result.advanced++;
      if (isTerminal(advanced.status)) result.settled++;
    } catch {
      // One bad job must never abort the batch — that is how a single
      // poison-pill request starves every other job in the queue.
      result.errors++;
    }
  }

  return result;
}

/**
 * A best-effort sweep triggered by ordinary traffic.
 *
 * Cron is the primary trigger, but it can be misconfigured, throttled (Vercel's
 * hobby tier allows only daily), or silently disabled. Piggybacking on real
 * requests means an app with users self-heals regardless. Deliberately small,
 * rate-limited, and never awaited by the request that triggered it.
 */
let lastPiggyback = 0;

/**
 * Tuned to the visitor waiting on a result, not to server thrift.
 *
 * Someone watching a pending tile polls every second or so; a coarse interval
 * would mean long stretches where their own traffic is doing nothing for them.
 * The cost is bounded anyway — `claimDueJobs` pushes `nextPollAt` forward as it
 * claims, so a sweep with nothing due is one cheap indexed query.
 */
const PIGGYBACK_INTERVAL_MS = 2_000;
const PIGGYBACK_BATCH = 5;

export function maybeSweep(now: number = Date.now()): void {
  if (now - lastPiggyback < PIGGYBACK_INTERVAL_MS) return;
  lastPiggyback = now;

  // Fire and forget: the visitor's request must not wait on someone else's job.
  void sweep({ limit: PIGGYBACK_BATCH }).catch(() => {
    // A failed background sweep is not the triggering request's problem. Cron
    // remains the primary path and will retry.
  });
}

/** Test seam so cases are not affected by the module-level throttle. */
export function resetPiggyback(): void {
  lastPiggyback = 0;
}
