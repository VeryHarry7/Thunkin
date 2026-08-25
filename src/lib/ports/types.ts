import type { GenerationParams, Job, ModelDescriptor } from "@/lib/contracts";
import type { ProviderOutput } from "@/lib/provider";

/**
 * Ports.
 *
 * The generation core needs a model registry, an API key, and asset ingest.
 * These narrow interfaces are how it gets them without importing any of their
 * implementations directly — all three are wired in one place,
 * `src/lib/ports/index.ts`, which is therefore the only file to read to know
 * what is actually connected.
 *
 * They also happen to be where tests substitute a fake.
 */

/**
 * Turns the look a visitor picked into a concrete model and a provider payload.
 *
 * Owned by AGENT-02.
 */
export interface LookResolver {
  /** Null when the look id is unknown — callers must treat that as a 400. */
  resolveLook(lookId: string): ModelDescriptor | null;

  /**
   * Adapts normalized params into whatever this specific model wants. Keeping
   * this behind the port is what lets the UI stay model-agnostic.
   */
  toProviderParams(
    descriptor: ModelDescriptor,
    params: GenerationParams,
  ): GenerationParams;
}

/**
 * Supplies the fal key a generation runs on.
 *
 * One server-side key for the whole service; the session id is accepted and
 * ignored, and remains only as the seam if this ever needs to be per-visitor
 * again. Implementations must never log, return, or serialize the key anywhere
 * other than straight into a provider call.
 */
export interface KeyResolver {
  /** Null when no key is configured — callers must return NO_KEY. */
  getKeyForSession(sessionId: string): Promise<string | null>;
}

/**
 * Copies a finished result out of the provider's expiring URLs and into our
 * own storage.
 *
 * Owned by AGENT-05. Throwing here fails the job with `INGEST_FAILED`, which is
 * deliberate: a result we could not keep is not a result we should show.
 */
export interface IngestPort {
  ingest(job: Job, outputs: ProviderOutput[]): Promise<void>;
}
