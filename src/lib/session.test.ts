import { describe, it, expect } from "vitest";
import { newSessionId, signSessionId, verifySessionCookie } from "./session";

/**
 * The session cookie is the only thing tying an anonymous visitor to their
 * jobs, so a forged or mangled value must never resolve to a session.
 */

describe("session signing", () => {
  it("round-trips a freshly minted id", () => {
    const id = newSessionId();
    expect(verifySessionCookie(signSessionId(id))).toBe(id);
  });

  it("rejects a cookie whose id was swapped for another", () => {
    // The attack this exists to stop: edit the id, keep the signature, read
    // someone else's library.
    const mine = signSessionId(newSessionId());
    const forged = `${newSessionId()}.${mine.split(".")[1]}`;
    expect(verifySessionCookie(forged)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const value = signSessionId(newSessionId());
    expect(verifySessionCookie(`${value}tampered`)).toBeNull();
  });

  it("rejects an unsigned id", () => {
    expect(verifySessionCookie(newSessionId())).toBeNull();
  });

  it("rejects empty and malformed values without throwing", () => {
    for (const value of [undefined, "", ".", "no-separator", ".onlysig"]) {
      expect(verifySessionCookie(value)).toBeNull();
    }
  });

  it("mints a distinct id each time", () => {
    const ids = new Set(Array.from({ length: 50 }, newSessionId));
    expect(ids.size).toBe(50);
  });
});
