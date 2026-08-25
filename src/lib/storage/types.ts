/**
 * The storage boundary.
 *
 * Same pattern as `src/lib/ports/` and for the same reason: no cloud
 * credentials exist yet, and blocking a visible product on procuring them would
 * be the wrong trade. The local-disk implementation is honest about being
 * development-only; the R2 implementation is this interface with a different
 * body, and nothing above it changes.
 */
export interface StoragePort {
  readonly name: "local" | "r2";

  /** Writes bytes under `key`, overwriting. */
  put(key: string, body: Uint8Array, mime: string): Promise<void>;

  /** Reads bytes back. Null when the key does not exist. */
  get(key: string): Promise<{ body: Uint8Array; mime: string } | null>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;
}
