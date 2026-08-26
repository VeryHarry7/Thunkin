import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { newSessionId, signSessionId, verifySessionCookie } from "./session";

/**
 * The session cookie records which device made a thing. Signing keeps the id
 * from being edited into a collision with another device's — and since the
 * signing moved onto the shared Web Crypto helpers, these also stand guard
 * over cookie compatibility across that move.
 */

describe("session signing", () => {
  it("round-trips a freshly minted id", async () => {
    const id = newSessionId();
    expect(await verifySessionCookie(await signSessionId(id))).toBe(id);
  });

  it("still verifies a cookie signed by the old node:crypto implementation", async () => {
    // The signing implementation changed (node:crypto → shared Web Crypto
    // helpers); the bytes must not have. A device's existing cookie has to
    // survive the swap, or every browser silently becomes a "new device".
    const id = newSessionId();
    const legacySignature = createHmac(
      "sha256",
      "test-session-secret-not-for-any-real-deployment",
    )
      .update(id)
      .digest("base64url");

    expect(await verifySessionCookie(`${id}.${legacySignature}`)).toBe(id);
  });

  it("rejects a cookie whose id was swapped for another", async () => {
    // The attack this exists to stop: edit the id, keep the signature.
    const mine = await signSessionId(newSessionId());
    const forged = `${newSessionId()}.${mine.split(".").at(-1)}`;
    expect(await verifySessionCookie(forged)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const value = await signSessionId(newSessionId());
    expect(await verifySessionCookie(`${value}tampered`)).toBeNull();
  });

  it("rejects an unsigned id", async () => {
    expect(await verifySessionCookie(newSessionId())).toBeNull();
  });

  it("rejects a signed value from a different cookie family", async () => {
    // Correctly signed, but not a session id — the prefix check is what keeps
    // one cookie's authority from leaking into another's.
    const { signValue } = await import("@/lib/auth/signing");
    const other = await signValue(
      "unlocked.v2.123.abc",
      "test-session-secret-not-for-any-real-deployment",
    );
    expect(await verifySessionCookie(other)).toBeNull();
  });

  it("rejects empty and malformed values without throwing", async () => {
    for (const value of [undefined, "", ".", "no-separator", ".onlysig"]) {
      expect(await verifySessionCookie(value)).toBeNull();
    }
  });

  it("mints a distinct id each time", () => {
    const ids = new Set(Array.from({ length: 50 }, newSessionId));
    expect(ids.size).toBe(50);
  });
});
