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

/** How many jobs one sweep handles. Bounded so one tick cannot run unboundedly long. */
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
    } catch (error) {
      // One bad job must never abort the batch — that is how a single
      // poison-pill request starves every other job in the queue. But a
      // swallowed error is invisible, and this was the one place a repeatedly
      // failing job could fail in silence forever.
      console.error(
        `[sweep] job ${job.id} failed:`,
        error instanceof Error ? error.message : String(error),
      );
      result.errors++;
    }
  }

  return result;
}

/* ======================================================================
 * The background loop
 *
 * On a home network fal cannot deliver a webhook at all, so this is not a
 * safety net — it is *the* way a job finishes.
 *
 * Started lazily on the first sweep rather than from `instrumentation.ts`,
 * because adding Edge middleware makes Next compile the instrumentation hook
 * for the Edge runtime too, and this module reaches `node:fs` through the
 * asset pipeline. A runtime guard does not help: webpack traces the import
 * either way.
 *
 * Lazy costs nothing here. Jobs only exist because someone loaded the app, and
 * loading the app runs `maybeSweep()` — so the loop is always running by the
 * time there is anything to sweep, and keeps running afterwards.
 * =================================================================== */

const LOOP_INTERVAL_MS = 30_000;
const LOOP_BATCH = 25;

/**
 * Parked on globalThis so dev HMR cannot stack a dozen concurrent loops, each
 * claiming rows the others just released.
 */
const globalForLoop = globalThis as unknown as {
  __thunkinSweepTimer?: ReturnType<typeof setInterval>;
};

export function ensureSweepLoop(): void {
  if (globalForLoop.__thunkinSweepTimer) return;

  const timer = setInterval(() => {
    void sweep({ limit: LOOP_BATCH }).catch((error) => {
      // A failed sweep must never take the process down: the next tick is
      // 30 seconds away and jobs stay recoverable until their ceiling.
      console.error("[sweep] failed", error);
    });
  }, LOOP_INTERVAL_MS);

  // Never hold the process open on this alone — shutdown should not wait out
  // an interval.
  timer.unref?.();
  globalForLoop.__thunkinSweepTimer = timer;

  console.warn(`[sweep] reconciler running every ${LOOP_INTERVAL_MS / 1000}s`);
}

/** Test seam, and the polite thing to call on shutdown. */
export function stopSweepLoop(): void {
  if (!globalForLoop.__thunkinSweepTimer) return;
  clearInterval(globalForLoop.__thunkinSweepTimer);
  delete globalForLoop.__thunkinSweepTimer;
}

let lastPiggyback = 0;

/**
 * A best-effort sweep triggered by ordinary traffic.
 *
 * The 30-second loop above is the reliable path; this one exists for latency.
 * Someone watching a pending tile polls every second or so, and waiting up to
 * 30s for the next tick would make a finished image feel late. Deliberately
 * small, rate-limited, and never awaited by the request that triggered it.
 *
 * The interval below is tuned to the person waiting on a result, not to server
 * thrift: a coarse one would mean long stretches where their own traffic is
 * doing nothing for them. The cost is bounded anyway — `claimDueJobs` pushes
 * `nextPollAt` forward as it claims, so a sweep with nothing due is one cheap
 * indexed query.
 */
const PIGGYBACK_INTERVAL_MS = 2_000;
const PIGGYBACK_BATCH = 5;

export function maybeSweep(now: number = Date.now()): void {
  // First traffic of the process starts the background loop.
  ensureSweepLoop();

  if (now - lastPiggyback < PIGGYBACK_INTERVAL_MS) return;
  lastPiggyback = now;

  // Fire and forget: the visitor's request must not wait on someone else's job.
  void sweep({ limit: PIGGYBACK_BATCH }).catch(() => {
    // A failed background sweep is not the triggering request's problem. The
    // interval loop remains the primary path and will retry.
  });
}

/** Test seam so cases are not affected by the module-level throttle. */
export function resetPiggyback(): void {
  lastPiggyback = 0;
}
