import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { getProvider, ProviderError, type ProviderOutput } from "@/lib/provider";
import { getIngestPort, getKeyResolver, getLookResolver } from "@/lib/ports";
import type { GenerationParams, Job, JobErrorCode } from "@/lib/contracts";
import { eventForProviderStatus, type TransitionSource } from "./machine";
import {
  applyTransition,
  createJob,
  getJob,
  getJobByRequestId,
  schedulePoll,
} from "./repo";
import { hasExpired } from "./backoff";
import { webhookUrlFor } from "@/lib/net/reachability";

/**
 * The generation service.
 *
 * Everything the routes do, minus HTTP. Both the webhook and the sweeper reach
 * the provider through `advanceJob` here, which is what stops the two paths
 * from drifting apart in how they interpret a provider response.
 */

export class ServiceError extends Error {
  readonly code: JobErrorCode | "NO_KEY" | "BAD_REQUEST" | "NOT_FOUND";

  constructor(
    code: JobErrorCode | "NO_KEY" | "BAD_REQUEST" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
  }
}

export interface SubmitJobInput {
  sessionId: string;
  lookId: string;
  params: GenerationParams;
  /** Supplied by the client so a double-tap collapses to one job. */
  idempotencyKey?: string;
}

/**
 * Creates and submits a job.
 *
 * The order matters: the job row exists before the provider is called, and the
 * request id is persisted before this returns. A crash between those points
 * leaves a recoverable job rather than an untracked provider request.
 */
export async function submitJob(input: SubmitJobInput): Promise<Job> {
  const descriptor = getLookResolver().resolveLook(input.lookId);
  if (!descriptor) {
    throw new ServiceError("BAD_REQUEST", `Unknown look: ${input.lookId}`);
  }

  const apiKey = await getKeyResolver().getKeyForSession(input.sessionId);
  if (!apiKey) {
    throw new ServiceError(
      "NO_KEY",
      "No fal key configured. Set FAL_KEY in .env.local and restart.",
    );
  }

  const params = getLookResolver().toProviderParams(descriptor, input.params);

  const { job, created } = await createJob({
    sessionId: input.sessionId,
    kind: descriptor.kind,
    lookId: descriptor.lookId,
    modelId: descriptor.endpoint,
    params,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
  });

  // A repeated idempotency key returns the original job untouched — resubmitting
  // it would create a second provider request the visitor pays for twice.
  if (!created) return job;

  await applyTransition(job.id, { type: "SUBMIT_STARTED" }, "client");

  try {
    const { requestId } = await getProvider().submit({
      endpoint: descriptor.endpoint,
      kind: descriptor.kind,
      params,
      apiKey,
      webhookUrl: webhookUrlFor(env.PUBLIC_URL),
    });

    await applyTransition(
      job.id,
      { type: "SUBMIT_ACCEPTED", falRequestId: requestId },
      "client",
    );

    // Schedule before re-reading, so the job handed back carries the same
    // nextPollAt the database holds. Returning the pre-schedule snapshot would
    // tell a client the job is never going to be polled.
    await schedulePoll(job.id, 0);

    const scheduled = await getJob(job.id, input.sessionId);
    return scheduled ?? job;
  } catch (error) {
    const failure = toFailure(error);
    const outcome = await applyTransition(
      job.id,
      { type: "FAILED", code: failure.code, message: failure.message },
      "client",
    );
    return outcome.job;
  }
}

/**
 * Advances a job by asking the provider where it is.
 *
 * The single path both the webhook and the sweeper take. `source` is recorded
 * on the event so AGENT-12 can watch the webhook-versus-sweeper ratio — a
 * rising sweeper share is how a broken webhook announces itself.
 */
export async function advanceJob(job: Job, source: TransitionSource): Promise<Job> {
  if (!job.falRequestId) return job;

  const apiKey = await getKeyResolver().getKeyForSession(job.sessionId);
  if (!apiKey) {
    // Without a key we can neither poll nor fetch a result, and the job would
    // sit non-terminal forever. Fail it rather than orphan it.
    const outcome = await applyTransition(
      job.id,
      {
        type: "FAILED",
        code: "INVALID_KEY",
        message: "No fal key configured, so this result could not be fetched.",
      },
      source,
    );
    return outcome.job;
  }

  // Expiry is checked before polling: a stalled job must reach a terminal state
  // even when the provider keeps cheerfully reporting IN_QUEUE.
  if (hasExpired(job)) {
    const outcome = await applyTransition(job.id, { type: "EXPIRED" }, source);
    return outcome.job;
  }

  let status;
  try {
    status = await getProvider().status(job.modelId, job.falRequestId, apiKey);
  } catch (error) {
    const failure = toFailure(error);
    if (failure.retryable) {
      // Transient. Leave the job alone and let the next sweep try again.
      await schedulePoll(job.id, job.attempt + 1);
      return job;
    }
    const outcome = await applyTransition(
      job.id,
      { type: "FAILED", code: failure.code, message: failure.message },
      source,
    );
    return outcome.job;
  }

  const event = eventForProviderStatus(status.status, {
    ...(status.queuePosition !== undefined
      ? { queuePosition: status.queuePosition }
      : {}),
    ...(status.errorCode ? { code: status.errorCode } : {}),
    ...(status.errorMessage ? { message: status.errorMessage } : {}),
  });

  const outcome = await applyTransition(job.id, event, source);

  if (outcome.job.status === "ingesting") {
    return ingestJob(outcome.job, apiKey, source);
  }

  if (outcome.job.status === "queued" || outcome.job.status === "running") {
    await schedulePoll(job.id, job.attempt + 1);
  }

  return outcome.job;
}

/**
 * Copies a finished result into our own storage, then marks the job ready.
 *
 * An ingest failure fails the job rather than marking it ready: a result we
 * could not keep is not a result we should show, because the provider's URL
 * will expire and the library would 404.
 */
async function ingestJob(
  job: Job,
  apiKey: string,
  source: TransitionSource,
): Promise<Job> {
  try {
    const result = await getProvider().result(job.modelId, job.falRequestId!, apiKey);
    const outputs: ProviderOutput[] = result.outputs;

    await getIngestPort().ingest(job, outputs);

    const outcome = await applyTransition(job.id, { type: "INGEST_COMPLETED" }, source);
    return outcome.job;
  } catch (error) {
    const failure = toFailure(error, "INGEST_FAILED");
    const outcome = await applyTransition(
      job.id,
      { type: "FAILED", code: failure.code, message: failure.message },
      source,
    );
    return outcome.job;
  }
}

/** Handles a verified webhook by re-checking with the provider. */
export async function handleWebhook(falRequestId: string): Promise<Job | null> {
  const job = await getJobByRequestId(falRequestId);
  if (!job) return null;

  /*
   * The webhook tells us *that* something happened, not what to believe. We
   * re-read status from the provider rather than trusting the delivered
   * payload, so a replayed or reordered delivery cannot move a job backwards.
   */
  return advanceJob(job, "webhook");
}

export async function cancelJob(jobId: string, sessionId: string): Promise<Job> {
  const job = await getJob(jobId, sessionId);
  if (!job) throw new ServiceError("NOT_FOUND", "No such job.");

  if (job.falRequestId) {
    const apiKey = await getKeyResolver().getKeyForSession(sessionId);
    if (apiKey) {
      try {
        await getProvider().cancel(job.modelId, job.falRequestId, apiKey);
      } catch {
        // Best effort. The visitor asked us to stop showing this; a provider
        // that will not cancel should not block that.
      }
    }
  }

  const outcome = await applyTransition(job.id, { type: "CANCELED" }, "client");
  return outcome.job;
}

/** Normalizes any thrown value into a taxonomy code and safe message. */
function toFailure(
  error: unknown,
  fallbackCode: JobErrorCode = "MODEL_ERROR",
): { code: JobErrorCode; message: string; retryable: boolean } {
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: fallbackCode,
    message: "Something went wrong on the way to the model.",
    retryable: false,
  };
}
