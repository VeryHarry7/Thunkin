import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  FAL_HEADERS,
  buildSignedMessage,
  parseWebhookBody,
  resetJwksCache,
  verifyFalWebhook,
  type FetchLike,
} from "./fal-signature";

const NOW = new Date("2026-08-25T12:00:00Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { privateKey, x: jwk.x };
}

function jwksFetch(xs: string[]): FetchLike {
  return async () =>
    new Response(
      JSON.stringify({ keys: xs.map((x) => ({ kty: "OKP", crv: "Ed25519", x })) }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
}

function headers(values: Record<string, string>) {
  const lower = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

/** Builds a correctly signed delivery. */
function signedDelivery(
  privateKey: ReturnType<typeof keypair>["privateKey"],
  options: {
    body?: string;
    requestId?: string;
    userId?: string;
    timestamp?: number;
  } = {},
) {
  const body = options.body ?? JSON.stringify({ request_id: "req_1", status: "OK" });
  const requestId = options.requestId ?? "wh_1";
  const userId = options.userId ?? "user_1";
  const timestamp = String(options.timestamp ?? NOW_SECONDS);
  const rawBody = new TextEncoder().encode(body);

  const message = buildSignedMessage(requestId, userId, timestamp, rawBody);
  const signature = sign(null, message, privateKey).toString("hex");

  return {
    rawBody,
    headers: headers({
      [FAL_HEADERS.requestId]: requestId,
      [FAL_HEADERS.userId]: userId,
      [FAL_HEADERS.timestamp]: timestamp,
      [FAL_HEADERS.signature]: signature,
    }),
  };
}

beforeEach(() => {
  resetJwksCache();
});

describe("a genuine delivery", () => {
  it("verifies", async () => {
    const { privateKey, x } = keypair();
    const delivery = signedDelivery(privateKey);

    const result = await verifyFalWebhook({
      ...delivery,
      fetchImpl: jwksFetch([x]),
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, requestId: "wh_1", userId: "user_1" });
  });

  it("verifies when only the second published key matches", async () => {
    // fal rotates keys, so a delivery may be signed by any key in the set.
    const other = keypair();
    const { privateKey, x } = keypair();
    const delivery = signedDelivery(privateKey);

    const result = await verifyFalWebhook({
      ...delivery,
      fetchImpl: jwksFetch([other.x, x]),
      now: NOW,
    });

    expect(result.ok).toBe(true);
  });

  it("survives a malformed key sitting in the set", async () => {
    const { privateKey, x } = keypair();
    const delivery = signedDelivery(privateKey);

    const fetchImpl: FetchLike = async () =>
      new Response(
        JSON.stringify({
          keys: [
            { kty: "OKP", crv: "Ed25519", x: "!!!not-base64!!!" },
            { kty: "OKP", crv: "Ed25519", x },
          ],
        }),
        { status: 200 },
      );

    expect((await verifyFalWebhook({ ...delivery, fetchImpl, now: NOW })).ok).toBe(
      true,
    );
  });

  it("accepts clock skew inside the tolerance", async () => {
    const { privateKey, x } = keypair();
    const delivery = signedDelivery(privateKey, { timestamp: NOW_SECONDS - 290 });

    expect(
      (await verifyFalWebhook({ ...delivery, fetchImpl: jwksFetch([x]), now: NOW })).ok,
    ).toBe(true);
  });
});

describe("rejections", () => {
  it("rejects a tampered body", async () => {
    const { privateKey, x } = keypair();
    const delivery = signedDelivery(privateKey);

    const result = await verifyFalWebhook({
      headers: delivery.headers,
      rawBody: new TextEncoder().encode('{"request_id":"req_evil","status":"OK"}'),
      fetchImpl: jwksFetch([x]),
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "SIGNATURE_MISMATCH" });
  });

  it("rejects a body altered only by whitespace", async () => {
    // The digest is over exact bytes, which is why the handler must not
    // re-serialize parsed JSON before verifying.
    const { privateKey, x } = keypair();
    const body = '{"request_id":"req_1","status":"OK"}';
    const delivery = signedDelivery(privateKey, { body });

    const result = await verifyFalWebhook({
      headers: delivery.headers,
      rawBody: new TextEncoder().encode('{"request_id": "req_1", "status": "OK"}'),
      fetchImpl: jwksFetch([x]),
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a stale timestamp beyond the tolerance", async () => {
    const { privateKey, x } = keypair();
    const delivery = signedDelivery(privateKey, { timestamp: NOW_SECONDS - 360 });

    expect(
      await verifyFalWebhook({ ...delivery, fetchImpl: jwksFetch([x]), now: NOW }),
    ).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });

  it("rejects a timestamp too far in the future", async () => {
    const { privateKey, x } = keypair();
    const delivery = signedDelivery(privateKey, { timestamp: NOW_SECONDS + 360 });

    expect(
      await verifyFalWebhook({ ...delivery, fetchImpl: jwksFetch([x]), now: NOW }),
    ).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });

  it("rejects a signature from a key fal never published", async () => {
    const attacker = keypair();
    const real = keypair();
    const delivery = signedDelivery(attacker.privateKey);

    expect(
      await verifyFalWebhook({
        ...delivery,
        fetchImpl: jwksFetch([real.x]),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "SIGNATURE_MISMATCH" });
  });

  it("rejects a delivery missing any required header", async () => {
    const { privateKey, x } = keypair();
    const delivery = signedDelivery(privateKey);

    for (const omitted of Object.values(FAL_HEADERS)) {
      const kept: Record<string, string> = {};
      for (const name of Object.values(FAL_HEADERS)) {
        if (name === omitted) continue;
        kept[name] = delivery.headers.get(name)!;
      }

      const result = await verifyFalWebhook({
        headers: headers(kept),
        rawBody: delivery.rawBody,
        fetchImpl: jwksFetch([x]),
        now: NOW,
      });

      expect(result, `omitting ${omitted}`).toEqual({
        ok: false,
        reason: "MISSING_HEADERS",
      });
    }
  });

  it("rejects a non-numeric timestamp", async () => {
    const { privateKey, x } = keypair();
    const delivery = signedDelivery(privateKey);

    const result = await verifyFalWebhook({
      headers: headers({
        [FAL_HEADERS.requestId]: "wh_1",
        [FAL_HEADERS.userId]: "user_1",
        [FAL_HEADERS.timestamp]: "not-a-number",
        [FAL_HEADERS.signature]: delivery.headers.get(FAL_HEADERS.signature)!,
      }),
      rawBody: delivery.rawBody,
      fetchImpl: jwksFetch([x]),
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "BAD_TIMESTAMP" });
  });

  it("rejects when fal publishes no keys", async () => {
    const { privateKey } = keypair();
    const delivery = signedDelivery(privateKey);

    expect(
      await verifyFalWebhook({ ...delivery, fetchImpl: jwksFetch([]), now: NOW }),
    ).toEqual({ ok: false, reason: "NO_KEYS" });
  });

  it("does not spend a network call on an obviously bad delivery", async () => {
    let fetched = 0;
    const counting: FetchLike = async () => {
      fetched++;
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    };

    await verifyFalWebhook({
      headers: headers({}),
      rawBody: new Uint8Array(),
      fetchImpl: counting,
      now: NOW,
    });

    expect(fetched).toBe(0);
  });
});

describe("JWKS caching", () => {
  it("fetches once and reuses the result", async () => {
    const { privateKey, x } = keypair();
    let fetched = 0;
    const counting: FetchLike = async () => {
      fetched++;
      return new Response(
        JSON.stringify({ keys: [{ kty: "OKP", crv: "Ed25519", x }] }),
        { status: 200 },
      );
    };

    for (let i = 0; i < 3; i++) {
      const delivery = signedDelivery(privateKey, { requestId: `wh_${i}` });
      await verifyFalWebhook({ ...delivery, fetchImpl: counting, now: NOW });
    }

    expect(fetched).toBe(1);
  });

  it("refetches once the cache is older than a day", async () => {
    const { privateKey, x } = keypair();
    let fetched = 0;
    const counting: FetchLike = async () => {
      fetched++;
      return new Response(
        JSON.stringify({ keys: [{ kty: "OKP", crv: "Ed25519", x }] }),
        { status: 200 },
      );
    };

    const first = signedDelivery(privateKey);
    await verifyFalWebhook({ ...first, fetchImpl: counting, now: NOW });

    const later = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    const second = signedDelivery(privateKey, {
      timestamp: Math.floor(later.getTime() / 1000),
    });
    await verifyFalWebhook({ ...second, fetchImpl: counting, now: later });

    expect(fetched).toBe(2);
  });

  it("serves stale keys rather than rejecting every webhook during an outage", async () => {
    const { privateKey, x } = keypair();
    let call = 0;
    const flaky: FetchLike = async () => {
      call++;
      return call === 1
        ? new Response(JSON.stringify({ keys: [{ kty: "OKP", crv: "Ed25519", x }] }), {
            status: 200,
          })
        : new Response("", { status: 503 });
    };

    const first = signedDelivery(privateKey);
    expect((await verifyFalWebhook({ ...first, fetchImpl: flaky, now: NOW })).ok).toBe(
      true,
    );

    const later = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    const second = signedDelivery(privateKey, {
      timestamp: Math.floor(later.getTime() / 1000),
    });

    expect(
      (await verifyFalWebhook({ ...second, fetchImpl: flaky, now: later })).ok,
    ).toBe(true);
  });
});

describe("parseWebhookBody", () => {
  it("reads a success delivery", () => {
    const raw = new TextEncoder().encode(
      JSON.stringify({ request_id: "req_1", status: "OK", payload: { images: [] } }),
    );
    expect(parseWebhookBody(raw)).toMatchObject({ request_id: "req_1", status: "OK" });
  });

  it("reads an error delivery", () => {
    const raw = new TextEncoder().encode(
      JSON.stringify({ request_id: "req_1", status: "ERROR", error: "boom" }),
    );
    expect(parseWebhookBody(raw)).toMatchObject({ status: "ERROR", error: "boom" });
  });

  it("returns null for malformed JSON rather than throwing", () => {
    expect(parseWebhookBody(new TextEncoder().encode("{not json"))).toBeNull();
  });

  it("returns null when request_id is absent", () => {
    const raw = new TextEncoder().encode(JSON.stringify({ status: "OK" }));
    expect(parseWebhookBody(raw)).toBeNull();
  });
});
