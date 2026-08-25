import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { StoragePort } from "./types";

/**
 * Local-disk storage, for development and tests.
 *
 * Writes under `.storage/` (gitignored). This is deliberately **not** suitable
 * for a deployment — serverless filesystems are ephemeral and per-instance, so
 * an asset written by one request would be missing from the next. AGENT-05's
 * full pass swaps in R2 behind the same interface.
 */

const ROOT = resolve(process.cwd(), ".storage");

/**
 * Keys come from our own code, but treating them as untrusted costs nothing
 * and closes a path traversal that would otherwise let a crafted key write
 * anywhere on disk.
 */
function pathFor(key: string): string {
  const full = resolve(ROOT, key);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) {
    throw new Error(`Refusing to access a storage key outside the root: ${key}`);
  }
  return full;
}

/** Mime is recorded alongside so `get` can return it without guessing. */
function metaPathFor(key: string): string {
  return `${pathFor(key)}.mime`;
}

export const localStorage: StoragePort = {
  name: "local",

  async put(key, body, mime) {
    const path = pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await writeFile(metaPathFor(key), mime, "utf8");
  },

  async get(key) {
    try {
      const body = await readFile(pathFor(key));
      let mime = "application/octet-stream";
      try {
        mime = await readFile(metaPathFor(key), "utf8");
      } catch {
        // Metadata missing is recoverable; the bytes are what matter.
      }
      return { body: new Uint8Array(body), mime };
    } catch {
      return null;
    }
  },

  async delete(key) {
    await rm(pathFor(key), { force: true });
    await rm(metaPathFor(key), { force: true });
  },

  async exists(key) {
    try {
      await readFile(pathFor(key));
      return true;
    } catch {
      return false;
    }
  },
};

export const LOCAL_STORAGE_ROOT = ROOT;
export { join as joinStorageKey };
