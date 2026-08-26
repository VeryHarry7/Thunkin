import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { StoragePort } from "./types";

/**
 * Local-disk storage.
 *
 * Writes under `.storage/`. On a machine you own with a persistent disk this
 * is the right answer, not a stand-in: object storage exists to solve
 * ephemeral, per-instance filesystems, and a box in your house has neither
 * problem.
 *
 * The one thing it does mean: `.storage/` and the database are a matched pair.
 * Back them up together or you have backed up neither.
 */

/**
 * `STORAGE_ROOT` exists for tests, which point it at a temp directory so they
 * never touch the real store. It is read once at module load like everything
 * else about this adapter; production leaves it unset.
 */
const ROOT = resolve(process.env.STORAGE_ROOT ?? resolve(process.cwd(), ".storage"));

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
    // Resolved before the try: the traversal guard's refusal must surface as
    // the error it is, not dissolve into "no such key".
    const path = pathFor(key);
    try {
      const body = await readFile(path);
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
};

export const LOCAL_STORAGE_ROOT = ROOT;
