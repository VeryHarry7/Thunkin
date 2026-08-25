import {
  isTerminal,
  type Job,
  type JobErrorCode,
  type JobStatus,
} from "@/lib/contracts";

/**
 * The job state machine.
 *
 * One pure function decides every status change in the system. The repository
 * is the only caller that persists the outcome, and nothing else writes
 * `jobs.status`. That single rule is what makes "zero orphaned jobs" a property
 * you can test rather than a hope.
 *
 *   draft → submitting → queued → running → ingesting → ready
 *                    ↘         ↘        ↘         ↘
 *                      failed · canceled · expired
 */

/** Which subsystem drove a transition. Recorded on every event. */
export type TransitionSource = "client" | "webhook" | "sweeper" | "system";

export type JobEventInput =
  | { type: "SUBMIT_STARTED" }
  | { type: "SUBMIT_ACCEPTED"; falRequestId: string }
  | { type: "PROVIDER_QUEUED"; queuePosition?: number }
  | { type: "PROVIDER_RUNNING" }
  | { type: "PROVIDER_COMPLETED" }
  | { type: "INGEST_STARTED" }
  | { type: "INGEST_COMPLETED" }
  | { type: "FAILED"; code: JobErrorCode; message: string }
  | { type: "CANCELED" }
  | { type: "EXPIRED" };

export type JobEventType = JobEventInput["type"];

/** The status each event moves a job into. */
const TARGET: Record<JobEventType, JobStatus> = {
  SUBMIT_STARTED: "submitting",
  SUBMIT_ACCEPTED: "queued",
  PROVIDER_QUEUED: "queued",
  PROVIDER_RUNNING: "running",
  PROVIDER_COMPLETED: "ingesting",
  INGEST_STARTED: "ingesting",
  INGEST_COMPLETED: "ready",
  FAILED: "failed",
  CANCELED: "canceled",
  EXPIRED: "expired",
};

/**
 * Which statuses each event may be applied from.
 *
 * Note that `PROVIDER_QUEUED` accepts `running`: fal can report a request back
 * in the queue after a runner releases it, and refusing that would strand the
 * job. Note too that `FAILED` accepts almost anything — a failure is always
 * allowed to interrupt.
 */
const ALLOWED_FROM: Record<JobEventType, readonly JobStatus[]> = {
  SUBMIT_STARTED: ["draft"],
  SUBMIT_ACCEPTED: ["submitting"],
  PROVIDER_QUEUED: ["queued", "running"],
  PROVIDER_RUNNING: ["queued", "running"],
  PROVIDER_COMPLETED: ["queued", "running", "ingesting"],
  INGEST_STARTED: ["ingesting"],
  INGEST_COMPLETED: ["ingesting"],
  FAILED: ["draft", "submitting", "queued", "running", "ingesting"],
  CANCELED: ["draft", "submitting", "queued", "running"],
  EXPIRED: ["submitting", "queued", "running", "ingesting"],
};

/** Thrown when an event cannot legally apply to a job's current status. */
export class IllegalTransition extends Error {
  readonly from: JobStatus;
  readonly event: JobEventType;

  constructor(from: JobStatus, event: JobEventType) {
    super(`Cannot apply ${event} to a job in status "${from}".`);
    this.name = "IllegalTransition";
    this.from = from;
    this.event = event;
  }
}

/** The changed fields plus the event to record. Never a mutated input. */
export interface TransitionResult {
  patch: Partial<Job> & { status: JobStatus };
  fromStatus: JobStatus;
  toStatus: JobStatus;
  data: Record<string, unknown> | null;
}

/**
 * Applies an event to a job.
 *
 * Returns `null` for a no-op, and throws `IllegalTransition` for a genuine
 * contradiction. Callers must handle both — they mean very different things.
 */
export function transition(
  job: Pick<Job, "status" | "kind" | "startedAt">,
  event: JobEventInput,
  now: Date = new Date(),
): TransitionResult | null {
  const from = job.status;
  const to = TARGET[event.type];

  /*
   * The convergence rule, and the reason this whole design works.
   *
   * The webhook and the sweeper race on every job, and both are correct — they
   * are two paths to the same truth. Whichever arrives first wins; the second
   * observes a job already in the target status and must be absorbed silently.
   *
   * Throwing here would turn ordinary operation into a constant stream of
   * errors and bury the real failures. Returning null keeps the second arrival
   * a no-op without pretending it did something.
   */
  if (from === to) return null;

  /*
   * Terminal means terminal. A late webhook for a job the visitor already
   * cancelled, or one that expired minutes ago, must not resurrect it.
   */
  if (isTerminal(from)) return null;

  if (!ALLOWED_FROM[event.type].includes(from)) {
    throw new IllegalTransition(from, event.type);
  }

  const patch: Partial<Job> & { status: JobStatus } = { status: to };
  let data: Record<string, unknown> | null = null;

  switch (event.type) {
    case "SUBMIT_STARTED":
      patch.submittedAt = now;
      break;

    case "SUBMIT_ACCEPTED":
      patch.falRequestId = event.falRequestId;
      data = { falRequestId: event.falRequestId };
      break;

    case "PROVIDER_QUEUED":
      patch.queuePosition = event.queuePosition ?? null;
      data = { queuePosition: event.queuePosition ?? null };
      break;

    case "PROVIDER_RUNNING":
      // Stamp only the first time. A job bounced back to the queue and picked
      // up again keeps its original start, so the elapsed time the visitor
      // watches stays honest instead of resetting mid-wait.
      if (job.startedAt === null) patch.startedAt = now;
      patch.queuePosition = null;
      break;

    case "PROVIDER_COMPLETED":
    case "INGEST_STARTED":
      patch.queuePosition = null;
      break;

    case "INGEST_COMPLETED":
      patch.completedAt = now;
      patch.nextPollAt = null;
      break;

    case "FAILED":
      patch.errorCode = event.code;
      patch.errorMessage = event.message;
      patch.completedAt = now;
      patch.nextPollAt = null;
      data = { code: event.code };
      break;

    case "CANCELED":
      patch.completedAt = now;
      patch.nextPollAt = null;
      break;

    case "EXPIRED":
      patch.errorCode = "TIMEOUT";
      patch.errorMessage = "This took longer than expected and was stopped.";
      patch.completedAt = now;
      patch.nextPollAt = null;
      break;
  }

  return { patch, fromStatus: from, toStatus: to, data };
}

/**
 * Maps a provider status onto the event it implies.
 *
 * Both the webhook handler and the sweeper go through here, which is what
 * guarantees the two paths cannot drift apart in how they interpret the
 * provider.
 */
export function eventForProviderStatus(
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED",
  detail: { queuePosition?: number; code?: JobErrorCode; message?: string } = {},
): JobEventInput {
  switch (status) {
    case "IN_QUEUE":
      return detail.queuePosition === undefined
        ? { type: "PROVIDER_QUEUED" }
        : { type: "PROVIDER_QUEUED", queuePosition: detail.queuePosition };
    case "IN_PROGRESS":
      return { type: "PROVIDER_RUNNING" };
    case "COMPLETED":
      return { type: "PROVIDER_COMPLETED" };
    case "FAILED":
      return {
        type: "FAILED",
        code: detail.code ?? "MODEL_ERROR",
        message: detail.message ?? "The model could not complete this request.",
      };
  }
}
