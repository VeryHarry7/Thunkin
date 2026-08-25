import type { GenerationParams, Job, ModelDescriptor } from "@/lib/contracts";
import type { ProviderOutput } from "@/lib/provider";

/**
 * Ports for capabilities other agents own.
 *
 * AGENT-04 sits on the critical path but needs a model registry (AGENT-02), a
 * decrypted key (AGENT-03), and asset ingest (AGENT-05). Rather than block on
 * three siblings, it codes against these narrow interfaces and ships thin
 * dev-only implementations behind them.
 *
 * When a sibling lands, it replaces the *implementation* in
 * `src/lib/ports/index.ts` — never the interface. If an interface needs to
 * change, that is a cross-agent break: open docs/handoffs/ first.
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
 * Supplies the visitor's own fal key for a session.
 *
 * Owned by AGENT-03. Implementations must never log, return, or serialize the
 * key anywhere other than straight into a provider call.
 */
export interface KeyResolver {
  /** Null when the session has no verified key — callers must return NO_KEY. */
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
