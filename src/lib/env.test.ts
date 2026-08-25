import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The env contract, exercised the only way it can be: by re-importing the
 * module under a different environment. It validates once at load, which is
 * the whole point — a misconfigured box fails at boot rather than on the first
 * generation — and that makes `vi.resetModules()` the test seam.
 */

async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
  return import("./env");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("FAL_KEY", () => {
  it("is optional under mock mode", async () => {
    const { env } = await loadEnv({ FAL_MODE: "mock", FAL_KEY: "" });
    expect(env.FAL_KEY).toBeUndefined();
  });

  it("treats an empty value as unset", async () => {
    // `.env.example` ships the line as `FAL_KEY=`. An untouched copy must not
    // count as a configured key.
    const { env } = await loadEnv({ FAL_MODE: "mock", FAL_KEY: "   " });
    expect(env.FAL_KEY).toBeUndefined();
  });

  it("refuses to boot in live mode with no key", async () => {
    await expect(loadEnv({ FAL_MODE: "live", FAL_KEY: "" })).rejects.toThrow(/FAL_KEY/);
  });

  it("boots in live mode with a key", async () => {
    const { env, isMockProvider } = await loadEnv({
      FAL_MODE: "live",
      FAL_KEY: "id:secret",
    });
    expect(env.FAL_KEY).toBe("id:secret");
    expect(isMockProvider).toBe(false);
  });
});

describe("required values", () => {
  it("rejects a passphrase short enough to guess", async () => {
    await expect(loadEnv({ APP_PASSPHRASE: "short" })).rejects.toThrow(
      /APP_PASSPHRASE/,
    );
  });

  it("rejects a session secret too short to sign with", async () => {
    await expect(loadEnv({ SESSION_SECRET: "tooshort" })).rejects.toThrow(
      /SESSION_SECRET/,
    );
  });

  it("names every problem at once rather than one per restart", async () => {
    await expect(
      loadEnv({ APP_PASSPHRASE: "x", SESSION_SECRET: "y", PUBLIC_URL: "nonsense" }),
    ).rejects.toThrow(/APP_PASSPHRASE[\s\S]*PUBLIC_URL/);
  });
});
