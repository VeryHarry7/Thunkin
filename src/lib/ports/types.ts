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
 * Two steps, deliberately separate, because their outputs go to different
 * places: normalized params are **persisted** on the job and read back by the
 * UI, while the provider payload is **sent** and belongs to one model's API.
 * Collapsing them was the old design's mistake — it forced one shared field
 * mapping onto every endpoint, which is exactly what made "adding a model is
 * a one-file change" untrue.
 */
export interface LookResolver {
  /** Null when the look id is unknown — callers must treat that as a 400. */
  resolveLook(lookId: string): ModelDescriptor | null;

  /**
   * Drops what this model cannot honour and clamps what it can. The result is
   * still `GenerationParams` — it is what gets stored on the job.
   */
  normalizeParams(
    descriptor: ModelDescriptor,
    params: GenerationParams,
  ): GenerationParams;

  /**
   * Normalized params into the exact body this model's endpoint wants. The
   * provider transports this verbatim; every model-specific field name lives
   * behind this call.
   */
  toProviderParams(
    descriptor: ModelDescriptor,
    params: GenerationParams,
  ): Record<string, unknown>;
}

/**
 * Supplies the fal key a generation runs on.
 *
 * One server-side key for the whole service. If this ever becomes
 * per-visitor, adding a parameter here is a ten-minute change — cheaper than
 * carrying an ignored one everywhere in the meantime. Implementations must
 * never log, return, or serialize the key anywhere other than straight into a
 * provider call.
 */
export interface KeyResolver {
  /** Null when no key is configured — callers must return NO_KEY. */
  getKey(): Promise<string | null>;
}

/**
 * Copies a finished result out of the provider's expiring URLs and into our
 * own storage.
 *
 * Throwing here fails the job with `INGEST_FAILED`, which is
 * deliberate: a result we could not keep is not a result we should show.
 */
export interface IngestPort {
  ingest(job: Job, outputs: ProviderOutput[]): Promise<void>;
}
