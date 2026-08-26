/**
 * The storage boundary.
 *
 * Local disk under `.storage/` is the real implementation, not a stand-in:
 * one long-lived process on one machine is precisely the case a filesystem
 * serves well. The port stays because it costs nothing and is the seam if
 * this ever moves to object storage — a second implementation is this
 * interface with a different body, and nothing above it changes.
 */
export interface StoragePort {
  /** Identifies which implementation is live, for logs. */
  readonly name: string;

  /** Writes bytes under `key`, overwriting. */
  put(key: string, body: Uint8Array, mime: string): Promise<void>;

  /** Reads bytes back. Null when the key does not exist. */
  get(key: string): Promise<{ body: Uint8Array; mime: string } | null>;

  delete(key: string): Promise<void>;
}
