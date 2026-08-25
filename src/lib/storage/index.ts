import { localStorage } from "./local";
import type { StoragePort } from "./types";

export * from "./types";
export { localStorage, LOCAL_STORAGE_ROOT } from "./local";

/**
 * Resolves the active storage backend.
 *
 * Local disk, which for a single box with a real filesystem is the destination
 * rather than a waypoint. The port stays because it costs nothing and is the
 * seam if this ever needs to run somewhere ephemeral.
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
