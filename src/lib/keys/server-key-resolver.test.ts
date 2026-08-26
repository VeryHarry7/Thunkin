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
  it("returns the configured key in live mode", async () => {
    const { serverKeyResolver } = await loadResolver({
      FAL_MODE: "live",
      FAL_KEY: "id:secret",
    });
    await expect(serverKeyResolver.getKey()).resolves.toBe("id:secret");
  });

  it("resolves a key in mock mode with no FAL_KEY — the documented quickstart", async () => {
    // The regression this file exists for. `.env.example` ships `FAL_KEY=`
    // empty and the README promises mock mode "costs nothing, needs no key" —
    // but `submitJob` rejects a null key with NO_KEY before the mock provider
    // is ever reached, so returning null here 401s every generation on the one
    // path a new user is told to start with. Every test elsewhere supplies a
    // key, which is exactly why nothing caught it.
    const { serverKeyResolver } = await loadResolver({
      FAL_MODE: "mock",
      FAL_KEY: "",
    });
    await expect(serverKeyResolver.getKey()).resolves.toEqual(expect.any(String));
  });
});
