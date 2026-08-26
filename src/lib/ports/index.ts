import type { IngestPort, KeyResolver, LookResolver } from "./types";
import { registry } from "@/lib/models/registry";
import { serverKeyResolver } from "@/lib/keys/server-key-resolver";
import { assetIngest } from "@/lib/assets/ingest";

export * from "./types";

/**
 * Port resolution.
 *
 * Every port has its real implementation wired here, and this is the only
 * file that decides what is wired — one place to read to know what actually
 * runs.
 *
 * Overrides exist for tests only. Production code must always go through the
 * accessors so that single place stays the truth.
 */

let lookResolver: LookResolver = registry;
let keyResolver: KeyResolver = serverKeyResolver;
let ingestPort: IngestPort = assetIngest;

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
  lookResolver = registry;
  keyResolver = serverKeyResolver;
  ingestPort = assetIngest;
}

export { serverKeyResolver };
