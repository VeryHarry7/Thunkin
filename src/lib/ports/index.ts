import type { IngestPort, KeyResolver, LookResolver } from "./types";
import { seedRegistry } from "./dev/seed-registry";
import { devKeyResolver } from "./dev/dev-key-resolver";
import { noopIngest } from "./dev/noop-ingest";

export * from "./types";

/**
 * Port resolution.
 *
 * Each accessor returns the dev implementation today. When a sibling agent
 * lands, it changes **one return statement here** and nothing else in the
 * codebase moves:
 *
 *   getLookResolver → AGENT-02's curated registry
 *   getKeyResolver  → AGENT-03's vault-backed resolver
 *   getIngestPort   → AGENT-05's asset pipeline
 *
 * Overrides exist for tests only. Production code must always go through the
 * accessors so there is a single place to audit what is wired.
 */

let lookResolver: LookResolver = seedRegistry;
let keyResolver: KeyResolver = devKeyResolver;
let ingestPort: IngestPort = noopIngest;

export function getLookResolver(): LookResolver {
  return lookResolver;
}

export function getKeyResolver(): KeyResolver {
  return keyResolver;
}

export function getIngestPort(): IngestPort {
  return ingestPort;
}

/** Test seam. Call `resetPorts()` afterwards so cases stay independent. */
export function setPortsForTesting(ports: {
  lookResolver?: LookResolver;
  keyResolver?: KeyResolver;
  ingestPort?: IngestPort;
}): void {
  if (ports.lookResolver) lookResolver = ports.lookResolver;
  if (ports.keyResolver) keyResolver = ports.keyResolver;
  if (ports.ingestPort) ingestPort = ports.ingestPort;
}

export function resetPorts(): void {
  lookResolver = seedRegistry;
  keyResolver = devKeyResolver;
  ingestPort = noopIngest;
}

export { seedRegistry, devKeyResolver, noopIngest };
export { SEED_LOOK_LIST } from "./dev/seed-registry";
