import { describe, it, expect } from "vitest";
import {
  EXPIRY_CEILING_MS,
  MAX_POLL_INTERVAL_MS,
  hasExpired,
  nextPollAt,
  pollDelayMs,
} from "./backoff";

const NOW = new Date("2026-08-25T12:00:00Z");

describe("pollDelayMs", () => {
  it("follows the documented schedule", () => {
    expect([0, 1, 2, 3].map(pollDelayMs)).toEqual([2_000, 5_000, 15_000, 60_000]);
  });

  it("caps at the maximum interval rather than growing without bound", () => {
    expect(pollDelayMs(4)).toBe(MAX_POLL_INTERVAL_MS);
    expect(pollDelayMs(99)).toBe(MAX_POLL_INTERVAL_MS);
  });

  it("never returns a delay below the first step", () => {
    // A corrupt negative attempt must not produce a zero-delay hot loop.
    expect(pollDelayMs(-1)).toBe(2_000);
  });

  it("increases monotonically", () => {
    const delays = [0, 1, 2, 3, 4, 5].map(pollDelayMs);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!);
    }
  });
});

describe("nextPollAt", () => {
  it("offsets from the supplied clock", () => {
    expect(nextPollAt(0, NOW).toISOString()).toBe("2026-08-25T12:00:02.000Z");
    expect(nextPollAt(3, NOW).toISOString()).toBe("2026-08-25T12:01:00.000Z");
  });
});

describe("expiry ceilings", () => {
  it("gives video twice the headroom of image", () => {
    expect(EXPIRY_CEILING_MS.video).toBe(EXPIRY_CEILING_MS.image * 2);
  });

  it("does not expire a job inside its ceiling", () => {
    const submittedAt = new Date(NOW.getTime() - 9 * 60_000);
    expect(
      hasExpired({ kind: "image", submittedAt, createdAt: submittedAt }, NOW),
    ).toBe(false);
  });

  it("expires a job past its ceiling", () => {
    const submittedAt = new Date(NOW.getTime() - 11 * 60_000);
    expect(
      hasExpired({ kind: "image", submittedAt, createdAt: submittedAt }, NOW),
    ).toBe(true);
  });

  it("still counts that same age as fine for video", () => {
    const submittedAt = new Date(NOW.getTime() - 11 * 60_000);
    expect(
      hasExpired({ kind: "video", submittedAt, createdAt: submittedAt }, NOW),
    ).toBe(false);
  });

  it("measures from submission, not creation", () => {
    // Time spent as a local draft is not the provider's fault. A job created
    // an hour ago but submitted a minute ago is young.
    const createdAt = new Date(NOW.getTime() - 60 * 60_000);
    const submittedAt = new Date(NOW.getTime() - 60_000);
    expect(hasExpired({ kind: "image", submittedAt, createdAt }, NOW)).toBe(false);
  });

  it("falls back to creation when a job was never submitted", () => {
    const createdAt = new Date(NOW.getTime() - 30 * 60_000);
    expect(hasExpired({ kind: "image", submittedAt: null, createdAt }, NOW)).toBe(true);
  });
});
