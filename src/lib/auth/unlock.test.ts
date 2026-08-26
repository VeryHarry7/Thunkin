import { describe, it, expect, beforeEach } from "vitest";
import {
  attemptsRemaining,
  clearAttempts,
  isUnlocked,
  mintUnlockCookie,
  passphraseMatches,
  recordFailedAttempt,
  resetAttempts,
} from "./unlock";
import { signValue } from "./signing";

/**
 * The passphrase is the entire access boundary, and behind it is a key that
 * spends money. These are the cases that decide whether it holds.
 */

beforeEach(() => {
  resetAttempts();
});

describe("the cookie", () => {
  it("round-trips a freshly minted cookie", async () => {
    expect(await isUnlocked(await mintUnlockCookie())).toBe(true);
  });

  it("rejects a forged cookie signed with the wrong secret", async () => {
    const forged = await signValue("unlocked:123", "not-the-session-secret");
    expect(await isUnlocked(forged)).toBe(false);
  });

  it("rejects an unsigned value", async () => {
    expect(await isUnlocked("unlocked:123")).toBe(false);
  });

  it("rejects a correctly signed value that is not an unlock", async () => {
    // Signature alone is not authority — the payload has to say what it is, or
    // any other signed cookie this app mints would double as a key.
    const other = await signValue(
      "sess_abc",
      "test-session-secret-not-for-any-real-deployment",
    );
    expect(await isUnlocked(other)).toBe(false);
  });

  it("rejects empty and malformed values without throwing", async () => {
    for (const value of [undefined, "", ".", "no-separator", ".onlysig"]) {
      expect(await isUnlocked(value)).toBe(false);
    }
  });
});

describe("the passphrase", () => {
  it("accepts the configured passphrase", async () => {
    expect(await passphraseMatches("test-passphrase")).toBe(true);
  });

  it("rejects anything else, including prefixes and empties", async () => {
    for (const wrong of ["", "test", "test-passphrase ", "TEST-PASSPHRASE", "x"]) {
      expect(await passphraseMatches(wrong)).toBe(false);
    }
  });
});

describe("attempt limiting", () => {
  it("counts down and eventually refuses", () => {
    expect(attemptsRemaining()).toBe(8);

    for (let i = 0; i < 8; i++) recordFailedAttempt();
    expect(attemptsRemaining()).toBe(0);
  });

  it("is one global bucket — a spoofed identity buys nothing", () => {
    // The limiter deliberately keys on nothing the caller sends. The previous
    // per-IP version could be reset per request via x-forwarded-for.
    for (let i = 0; i < 8; i++) recordFailedAttempt();
    expect(attemptsRemaining()).toBe(0);
  });

  it("forgives once the window passes", () => {
    const start = 1_000_000;
    for (let i = 0; i < 8; i++) recordFailedAttempt(start);
    expect(attemptsRemaining(start)).toBe(0);

    expect(attemptsRemaining(start + 11 * 60_000)).toBe(8);
  });

  it("clears on success — a correct passphrase is not an attack", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt();
    clearAttempts();
    expect(attemptsRemaining()).toBe(8);
  });
});
