import { localStorage } from "./local";
import type { StoragePort } from "./types";

export * from "./types";
export { localStorage, LOCAL_STORAGE_ROOT } from "./local";

/**
 * Resolves the active storage backend.
 *
 * Local disk today. When AGENT-05's full pass adds the R2 implementation, this
 * switches on the `R2_*` env values being present — one function body, and
 * nothing above the boundary moves.
 */
let storage: StoragePort = localStorage;

export function getStorage(): StoragePort {
  return storage;
}

/** Test seam. */
export function setStorageForTesting(next: StoragePort): void {
  storage = next;
}

export function resetStorage(): void {
  storage = localStorage;
}
