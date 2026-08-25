import type { GenerationParams, JobErrorCode, JobKind } from "@/lib/contracts";

/**
 * The provider boundary.
 *
 * FROZEN CONTRACT — AGENT-04 implements the `fal` adapter against this shape.
 * Everything above the boundary (job machine, routes, UI) is written against
 * the interface, never against fal directly, so the mock is a true stand-in
 * and a second provider stays a small change.
 */

export interface SubmitInput {
  /** The fal endpoint to invoke, from the registry. */
  endpoint: string;
  kind: JobKind;
  params: GenerationParams;
  /** The visitor's own key, decrypted at the last possible moment. */
  apiKey: string;
  /**
   * Where the provider should POST its completion callback, or null when
   * nothing on the internet can reach us — the normal case on a home network.
   * Null is not degraded: the sweeper completes the job either way.
   */
  webhookUrl: string | null;
}

export interface SubmitResult {
  /** The provider's id for this request. Persist it before returning. */
  requestId: string;
}

/** Provider-side status, normalized across providers. */
export type ProviderStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface StatusResult {
  status: ProviderStatus;
  /** Present while queued, when the provider reports it. */
  queuePosition?: number;
  /** Present when status is FAILED. */
  errorCode?: JobErrorCode;
  errorMessage?: string;
}

/** One produced file, still living at the provider's expiring URL. */
export interface ProviderOutput {
  url: string;
  mime: string;
  width: number;
  height: number;
  durationMs?: number;
}

export interface ResultPayload {
  outputs: ProviderOutput[];
  /** The seed actually used, so a result can be reproduced. */
  seed?: number;
}

/**
 * Raised when a provider call fails in a way the job machine should record.
 * Carries a taxonomy code so the UI's single-recovery-action rule holds.
 */
export class ProviderError extends Error {
  readonly code: JobErrorCode;
  /** Whether retrying the same request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(code: JobErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface Provider {
  /** Identifies which adapter is live, for logs and the health endpoint. */
  readonly name: "fal" | "mock";

  submit(input: SubmitInput): Promise<SubmitResult>;
  status(endpoint: string, requestId: string, apiKey: string): Promise<StatusResult>;
  result(endpoint: string, requestId: string, apiKey: string): Promise<ResultPayload>;
  cancel(endpoint: string, requestId: string, apiKey: string): Promise<void>;

  /** Cheap round-trip used to verify a key at entry. */
  verifyKey(apiKey: string): Promise<boolean>;
}
