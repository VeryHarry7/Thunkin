import { describe, expect, it } from "vitest";
import { signValue } from "./signing";
import {
  UNLOCK_MAX_AGE_SECONDS,
  mintUnlockValue,
  verifyUnlockValue,
} from "./unlock-cookie";

const SECRET = "test-session-secret-not-for-any-real-deployment";
const PASSPHRASE = "test-passphrase";

describe("the unlock cookie", () => {
  it("round-trips", async () => {
    const cookie = await mintUnlockValue(SECRET, PASSPHRASE);
    expect(await verifyUnlockValue(cookie, SECRET, PASSPHRASE)).toBe(true);
  });

  it("rejects a cookie signed with a different secret", async () => {
    const cookie = await mintUnlockValue("some-other-secret-entirely-here", PASSPHRASE);
    expect(await verifyUnlockValue(cookie, SECRET, PASSPHRASE)).toBe(false);
  });

  it("is revoked by rotating the passphrase", async () => {
    // The point of binding the passphrase tag into the payload: changing
    // APP_PASSPHRASE logs every device out, instead of issued cookies living
    // on forever under the old passphrase.
    const cookie = await mintUnlockValue(SECRET, PASSPHRASE);
    expect(await verifyUnlockValue(cookie, SECRET, "a-brand-new-passphrase")).toBe(
      false,
    );
  });

  it("expires server-side after the max age", async () => {
    // maxAge on the Set-Cookie is advice to the browser; this is the check
    // that makes a lifted cookie stop working.
    const issued = new Date("2025-01-01T00:00:00Z");
    const cookie = await mintUnlockValue(SECRET, PASSPHRASE, issued);

    const justInside = new Date(
      issued.getTime() + UNLOCK_MAX_AGE_SECONDS * 1000 - 1000,
    );
    const justPast = new Date(issued.getTime() + UNLOCK_MAX_AGE_SECONDS * 1000 + 1000);

    expect(await verifyUnlockValue(cookie, SECRET, PASSPHRASE, justInside)).toBe(true);
    expect(await verifyUnlockValue(cookie, SECRET, PASSPHRASE, justPast)).toBe(false);
  });

  it("rejects an issue time from the future beyond clock skew", async () => {
    const now = new Date("2025-01-01T00:00:00Z");
    const withinSkew = await mintUnlockValue(
      SECRET,
      PASSPHRASE,
      new Date(now.getTime() + 30_000),
    );
    const beyondSkew = await mintUnlockValue(
      SECRET,
      PASSPHRASE,
      new Date(now.getTime() + 5 * 60_000),
    );

    expect(await verifyUnlockValue(withinSkew, SECRET, PASSPHRASE, now)).toBe(true);
    expect(await verifyUnlockValue(beyondSkew, SECRET, PASSPHRASE, now)).toBe(false);
  });

  it("rejects the v1 format even when correctly signed", async () => {
    // The old payload carried no passphrase tag, so it must not verify —
    // otherwise the rotation guarantee has a permanent loophole.
    const v1 = await signValue(`unlocked:${Date.now()}`, SECRET);
    expect(await verifyUnlockValue(v1, SECRET, PASSPHRASE)).toBe(false);
  });

  it("rejects garbage without throwing", async () => {
    for (const value of [undefined, "", ".", "unlocked.v2", "a.b.c.d.e.f"]) {
      expect(await verifyUnlockValue(value, SECRET, PASSPHRASE)).toBe(false);
    }
  });
});
