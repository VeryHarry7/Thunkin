import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Anonymous sessions.
 *
 * Thunkin has no accounts: a signed cookie is the only thing tying a visitor to
 * their jobs. AGENT-03 owns the `sessions` table and the key vault; this module
 * owns only the cookie itself, which the generation core needs in order to
 * scope anything at all.
 *
 * The value is `<id>.<hmac>`. Signing stops a visitor from editing the cookie to
 * read someone else's library — the id alone would be trivially guessable-by-
 * enumeration otherwise.
 */

export const SESSION_COOKIE = "thunkin_sid";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Whether to mark the cookie `Secure`.
 *
 * Driven by the app's actual external origin rather than `NODE_ENV`, because
 * that is what decides whether a browser will store the cookie at all: a
 * `Secure` cookie sent over plain HTTP is silently discarded, and every request
 * then arrives with no session. A production build served over http — a local
 * `next start`, or the e2e suite — is a real case, and keying off `NODE_ENV`
 * breaks it in a way that looks like data loss rather than a cookie problem.
 *
 * Any genuine deployment has an https `PUBLIC_URL`, so this stays strict where
 * it matters.
 */
const USE_SECURE_COOKIE = env.PUBLIC_URL.startsWith("https://");

function signatureFor(id: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(id).digest("base64url");
}

export function signSessionId(id: string): string {
  return `${id}.${signatureFor(id)}`;
}

/** Returns the id only when the signature checks out. */
export function verifySessionCookie(value: string | undefined): string | null {
  if (!value) return null;

  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const id = value.slice(0, separator);
  const provided = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(signatureFor(id));

  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false.
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? id : null;
}

export function newSessionId(): string {
  return `sess_${randomUUID()}`;
}

/** The current session id, or null when there is no valid cookie. */
export async function getSessionId(): Promise<string | null> {
  const store = await cookies();
  return verifySessionCookie(store.get(SESSION_COOKIE)?.value);
}

/**
 * The current session id, minting one if needed.
 *
 * Route handlers may set cookies, so this is safe there. It is not safe in a
 * Server Component render, which is why reads go through `getSessionId`.
 */
export async function requireSessionId(): Promise<string> {
  const store = await cookies();
  const existing = verifySessionCookie(store.get(SESSION_COOKIE)?.value);
  if (existing) return existing;

  const id = newSessionId();
  store.set(SESSION_COOKIE, signSessionId(id), {
    httpOnly: true,
    secure: USE_SECURE_COOKIE,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });

  return id;
}
