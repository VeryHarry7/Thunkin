import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The key resolver is three lines, and all three are load-bearing: a wrong
 * answer here means either a generation that cannot run or — far worse — one
 * that runs on a key nobody configured.
 */

async function loadResolver(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
  return import("./server-key-resolver");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("serverKeyResolver", () => {
  it("returns the configured key", async () => {
    const { serverKeyResolver } = await loadResolver({ FAL_KEY: "id:secret" });
    await expect(serverKeyResolver.getKeyForSession("sess_a")).resolves.toBe(
      "id:secret",
    );
  });

  it("returns the same key for every session", async () => {
    // The point of the re-scope: your phone and your laptop generate on one
    // key, and the session id is recorded rather than used.
    const { serverKeyResolver } = await loadResolver({ FAL_KEY: "id:secret" });
    const [a, b] = await Promise.all([
      serverKeyResolver.getKeyForSession("sess_phone"),
      serverKeyResolver.getKeyForSession("sess_laptop"),
    ]);
    expect(a).toBe(b);
  });

  it("returns null rather than an empty string when no key is set", async () => {
    // `!apiKey` in the service catches both, but a null says "unconfigured"
    // where an empty string says "configured as nothing".
    const { serverKeyResolver } = await loadResolver({
      FAL_MODE: "mock",
      FAL_KEY: "",
    });
    await expect(serverKeyResolver.getKeyForSession("sess_a")).resolves.toBeNull();
  });
});
