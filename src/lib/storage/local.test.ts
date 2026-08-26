import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StoragePort } from "./types";

/**
 * The path-traversal guard is three lines that stand between a storage key
 * and the rest of the filesystem. A guard nobody tests is a guard nobody
 * notices breaking — and until this file, nobody tested it.
 */

let storage: StoragePort;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "thunkin-storage-test-"));
  vi.stubEnv("STORAGE_ROOT", root);
  vi.resetModules();
  ({ localStorage: storage } = await import("./local"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(root, { recursive: true, force: true });
});

describe("round trip", () => {
  it("stores and returns bytes with their mime", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await storage.put("sess_a/job_1/ast_1.png", bytes, "image/png");

    const stored = await storage.get("sess_a/job_1/ast_1.png");
    expect(stored?.mime).toBe("image/png");
    expect(stored?.body).toEqual(bytes);
  });

  it("returns null for a missing key and deletes without complaint", async () => {
    expect(await storage.get("sess_a/none")).toBeNull();
    await storage.delete("sess_a/none"); // force: true — absence is fine
    await storage.put("sess_a/gone", new Uint8Array([9]), "image/png");
    await storage.delete("sess_a/gone");
    expect(await storage.get("sess_a/gone")).toBeNull();
  });
});

describe("the traversal guard", () => {
  it("refuses every path that points outside the root", async () => {
    for (const key of ["../escape", "a/../../escape", "..", "a/../..", "/etc/passwd"]) {
      await expect(storage.get(key), key).rejects.toThrow(/outside the root/);
      await expect(storage.put(key, new Uint8Array([1]), "image/png")).rejects.toThrow(
        /outside the root/,
      );
      await expect(storage.delete(key)).rejects.toThrow(/outside the root/);
    }
  });

  it("allows dotted segments that stay inside", async () => {
    // `a/../b` resolves inside the root — the guard is about where a path
    // lands, not about punishing the characters in it.
    await storage.put("a/../inside.png", new Uint8Array([5]), "image/png");
    expect(await storage.get("inside.png")).not.toBeNull();
  });
});
