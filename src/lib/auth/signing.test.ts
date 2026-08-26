import { describe, expect, it } from "vitest";
import {
  secretsEqual,
  sign,
  signValue,
  timingSafeEqualString,
  verifySignedValue,
} from "./signing";

const SECRET = "a-secret-of-reasonable-length-for-tests";

describe("sign / verifySignedValue", () => {
  it("round-trips a value", async () => {
    const signed = await signValue("hello", SECRET);
    expect(await verifySignedValue(signed, SECRET)).toBe("hello");
  });

  it("round-trips a value containing dots", async () => {
    // The cookie format splits on the *last* dot, so dotted payloads — which
    // the v2 unlock cookie is — must survive.
    const signed = await signValue("a.b.c.d", SECRET);
    expect(await verifySignedValue(signed, SECRET)).toBe("a.b.c.d");
  });

  it("rejects a tampered value", async () => {
    const signed = await signValue("hello", SECRET);
    expect(
      await verifySignedValue(signed.replace("hello", "hellp"), SECRET),
    ).toBeNull();
  });

  it("rejects the right signature under the wrong secret", async () => {
    const signed = await signValue("hello", SECRET);
    expect(await verifySignedValue(signed, "another-secret-value-here")).toBeNull();
  });

  it("rejects malformed inputs without throwing", async () => {
    for (const value of [undefined, "", ".", "nodot", ".onlysig", "value."]) {
      expect(await verifySignedValue(value, SECRET)).toBeNull();
    }
  });

  it("is deterministic", async () => {
    expect(await sign("x", SECRET)).toBe(await sign("x", SECRET));
  });
});

describe("timingSafeEqualString", () => {
  it("compares equal and unequal strings", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "ab")).toBe(false);
  });
});

describe("secretsEqual", () => {
  it("matches identical secrets", async () => {
    expect(await secretsEqual("hunter2", "hunter2")).toBe(true);
  });

  it("rejects different secrets, including different lengths", async () => {
    // The reason this exists: hashing first means the comparison runs over a
    // fixed width, so a candidate's length is not observable through timing.
    expect(await secretsEqual("hunter2", "hunter3")).toBe(false);
    expect(await secretsEqual("hunter2", "hunter22")).toBe(false);
    expect(await secretsEqual("", "hunter2")).toBe(false);
  });
});
