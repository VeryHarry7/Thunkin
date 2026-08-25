import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

/**
 * Webhook signature verification.
 *
 * fal signs each delivery with ED25519. This module answers one question —
 * did fal really send this, recently? — and must be satisfied **before the
 * body is parsed or trusted in any way**, since an unverified webhook is just
 * an anonymous POST from the internet.
 */

const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";

/** fal's documented tolerance. Bounds replay of a captured delivery. */
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

/** fal rotates keys; the docs cap caching at 24 hours. */
const JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const FAL_HEADERS = {
  requestId: "x-fal-webhook-request-id",
  userId: "x-fal-webhook-user-id",
  timestamp: "x-fal-webhook-timestamp",
  signature: "x-fal-webhook-signature",
} as const;

export type VerificationFailure =
  | "MISSING_HEADERS"
  | "BAD_TIMESTAMP"
  | "STALE_TIMESTAMP"
  | "BAD_SIGNATURE_ENCODING"
  | "NO_KEYS"
  | "SIGNATURE_MISMATCH";

export type VerificationResult =
  | { ok: true; requestId: string; userId: string }
  | { ok: false; reason: VerificationFailure };

interface Jwk {
  x?: string;
  kty?: string;
  crv?: string;
}

let cache: { keys: Jwk[]; fetchedAt: number } | null = null;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Fetches fal's public keys, cached for at most 24 hours. */
export async function getJwks(
  fetchImpl: FetchLike = fetch,
  now: number = Date.now(),
): Promise<Jwk[]> {
  if (cache && now - cache.fetchedAt < JWKS_CACHE_TTL_MS) return cache.keys;

  const response = await fetchImpl(JWKS_URL);
  if (!response.ok) {
    // Serving a stale key beats rejecting every webhook during a JWKS blip —
    // the keys are long-lived and the timestamp check still bounds replay.
    if (cache) return cache.keys;
    throw new Error(`Could not fetch fal JWKS: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body?.keys) ? body.keys : [];

  cache = { keys, fetchedAt: now };
  return keys;
}

/** Clears the cached keys. Tests call this between cases. */
export function resetJwksCache(): void {
  cache = null;
}

/**
 * Rebuilds the signed message.
 *
 * Four parts joined by newlines, with the body represented by the hex SHA-256
 * of its **exact bytes** — which is why the handler must read the raw body
 * rather than re-serializing parsed JSON. Re-serializing changes key order and
 * whitespace, and the digest would no longer match.
 */
export function buildSignedMessage(
  requestId: string,
  userId: string,
  timestamp: string,
  rawBody: Uint8Array,
): Buffer {
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  return Buffer.from([requestId, userId, timestamp, bodyHash].join("\n"), "utf8");
}

export interface VerifyInput {
  headers: {
    get(name: string): string | null;
  };
  rawBody: Uint8Array;
  fetchImpl?: FetchLike;
  now?: Date;
}

/**
 * Verifies a fal webhook.
 *
 * Checks are ordered cheapest-first: a missing header or a stale timestamp is
 * rejected before we spend a network call on the JWKS.
 */
export async function verifyFalWebhook(
  input: VerifyInput,
): Promise<VerificationResult> {
  const now = input.now ?? new Date();

  const requestId = input.headers.get(FAL_HEADERS.requestId);
  const userId = input.headers.get(FAL_HEADERS.userId);
  const timestamp = input.headers.get(FAL_HEADERS.timestamp);
  const signature = input.headers.get(FAL_HEADERS.signature);

  if (!requestId || !userId || !timestamp || !signature) {
    return { ok: false, reason: "MISSING_HEADERS" };
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: "BAD_TIMESTAMP" };

  // Absolute difference: a timestamp far in the future is as suspicious as a
  // stale one, and clock skew can legitimately go either way.
  const driftSeconds = Math.abs(now.getTime() / 1000 - sentAt);
  if (driftSeconds > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: "STALE_TIMESTAMP" };
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signature, "hex");
    if (signatureBytes.length === 0) throw new Error("empty");
  } catch {
    return { ok: false, reason: "BAD_SIGNATURE_ENCODING" };
  }

  const keys = await getJwks(input.fetchImpl ?? fetch, now.getTime());
  if (keys.length === 0) return { ok: false, reason: "NO_KEYS" };

  const message = buildSignedMessage(requestId, userId, timestamp, input.rawBody);

  // fal rotates keys, so a delivery may be signed by any published key.
  for (const jwk of keys) {
    if (!jwk.x) continue;
    try {
      const publicKey = createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x: jwk.x },
        format: "jwk",
      });
      if (verifySignature(null, message, publicKey, signatureBytes)) {
        return { ok: true, requestId, userId };
      }
    } catch {
      // A malformed key in the set must not prevent the others from being tried.
      continue;
    }
  }

  return { ok: false, reason: "SIGNATURE_MISMATCH" };
}

/** The payload fal delivers, once verification has passed. */
export interface FalWebhookPayload {
  request_id: string;
  gateway_request_id?: string;
  status: "OK" | "ERROR";
  payload?: unknown;
  error?: unknown;
  payload_error?: unknown;
}

/** Parses a verified body. Only ever call this after `verifyFalWebhook`. */
export function parseWebhookBody(rawBody: Uint8Array): FalWebhookPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(rawBody).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const record = parsed as Record<string, unknown>;
    if (typeof record.request_id !== "string") return null;

    return {
      request_id: record.request_id,
      status: record.status === "ERROR" ? "ERROR" : "OK",
      ...(typeof record.gateway_request_id === "string"
        ? { gateway_request_id: record.gateway_request_id }
        : {}),
      payload: record.payload,
      error: record.error,
      payload_error: record.payload_error,
    };
  } catch {
    return null;
  }
}
