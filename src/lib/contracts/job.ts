import { z } from "zod";

/**
 * The job lifecycle.
 *
 * FROZEN CONTRACT — AGENT-04 owns the transition function that moves a job
 * between these states, but the state names themselves are shared vocabulary.
 * Changing one is a cross-agent break: raise it in docs/handoffs/ first.
 *
 *   draft → submitting → queued → running → ingesting → ready
 *                    ↘         ↘        ↘         ↘
 *                      failed · canceled · expired
 */
export const JobStatus = z.enum([
  /** Created locally, not yet sent to the provider. */
  "draft",
  /** Handed to the provider; awaiting a request id. */
  "submitting",
  /** Provider accepted it and it is waiting for a runner. */
  "queued",
  /** A runner is working on it. */
  "running",
  /** Provider finished; we are copying the result into our own storage. */
  "ingesting",
  /** Complete, ingested, and available in the library. */
  "ready",
  /** Terminal: something went wrong. `errorCode` says what. */
  "failed",
  /** Terminal: the visitor cancelled it. */
  "canceled",
  /** Terminal: exceeded the hard ceiling without reaching a result. */
  "expired",
]);
export type JobStatus = z.infer<typeof JobStatus>;

/** States from which no further transition is legal. */
export const TERMINAL_STATUSES = ["ready", "failed", "canceled", "expired"] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export function isTerminal(status: JobStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * The error taxonomy.
 *
 * Every failure the visitor can see maps to exactly one of these, and each one
 * maps to exactly one recovery action in the UI. "Never a dead end" is
 * enforceable only because this list is closed — resist adding a generic
 * `UNKNOWN` member.
 */
export const JobErrorCode = z.enum([
  /** The stored fal key was rejected. Recovery: re-enter the key. */
  "INVALID_KEY",
  /** The visitor's fal account is out of credit. Recovery: top up. */
  "INSUFFICIENT_CREDIT",
  /** The provider rate-limited us. Recovery: retry shortly. */
  "RATE_LIMITED",
  /** The prompt or an input was refused. Recovery: edit the prompt. */
  "CONTENT_REJECTED",
  /** The model itself errored. Recovery: retry, or swap look. */
  "MODEL_ERROR",
  /** Exceeded the hard ceiling. Recovery: retry. */
  "TIMEOUT",
  /** Transport failure talking to the provider. Recovery: retry. */
  "NETWORK",
  /** We could not copy the result into our storage. Recovery: retry. */
  "INGEST_FAILED",
]);
export type JobErrorCode = z.infer<typeof JobErrorCode>;

/** What a job produces. Drives which registry entries are eligible. */
export const JobKind = z.enum(["image", "video"]);
export type JobKind = z.infer<typeof JobKind>;

/**
 * Normalized generation input.
 *
 * One shape goes in; AGENT-02's registry adapts it into whatever payload each
 * model actually wants. The UI never constructs a model-specific body.
 */
export const GenerationParams = z.object({
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(2000).optional(),
  /** Width:height, e.g. "16:9". Constrained per-model by the registry. */
  aspectRatio: z.string().optional(),
  /** Omitted means "pick one" — the server fills it in so results are reproducible. */
  seed: z.number().int().nonnegative().optional(),
  /** Video only, in seconds. */
  durationSeconds: z.number().positive().max(60).optional(),
  /** Asset id or URL used as an image input (img2img, image-to-video). */
  inputAssetId: z.string().optional(),
});
export type GenerationParams = z.infer<typeof GenerationParams>;

/** A single recorded transition. The audit trail behind every job. */
export const JobEvent = z.object({
  id: z.string(),
  jobId: z.string(),
  at: z.date(),
  fromStatus: JobStatus.nullable(),
  toStatus: JobStatus,
  /** Which subsystem drove the transition — key evidence when debugging. */
  source: z.enum(["client", "webhook", "sweeper", "system"]),
  data: z.record(z.string(), z.unknown()).nullable(),
});
export type JobEvent = z.infer<typeof JobEvent>;

/** A generation request and everything we know about it. */
export const Job = z.object({
  id: z.string(),
  sessionId: z.string(),
  kind: JobKind,
  /** The registry look the visitor chose. */
  lookId: z.string(),
  /** The fal endpoint that look resolved to, captured at submit time. */
  modelId: z.string(),
  params: GenerationParams,
  status: JobStatus,

  /** The provider's id for this request. Null until submit succeeds. */
  falRequestId: z.string().nullable(),
  /** Provider-reported position while queued, when it tells us. */
  queuePosition: z.number().int().nonnegative().nullable(),

  errorCode: JobErrorCode.nullable(),
  /** Safe to show a visitor. Never contains provider internals or a key. */
  errorMessage: z.string().nullable(),

  /** Retry counter, used to bound automatic recovery. */
  attempt: z.number().int().nonnegative(),
  /** Dedupes double-submits from an impatient button. */
  idempotencyKey: z.string(),

  createdAt: z.date(),
  submittedAt: z.date().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  /** When the sweeper should next poll. Null once terminal. */
  nextPollAt: z.date().nullable(),
});
export type Job = z.infer<typeof Job>;
