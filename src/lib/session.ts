import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { signValue, verifySignedValue } from "@/lib/auth/signing";

/**
 * Device identity.
 *
 * Access is decided by the passphrase gate, not by this cookie. What this
 * gives is a stable id per browser, recorded on every job so you can tell
 * which device made a thing — reads deliberately ignore it, because your phone
 * and your laptop are the same person.
 *
 * The value is `<id>.<hmac>`. Signing costs nothing and keeps the id from being
 * edited into something that collides with another device's.
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

/*
 * Signing goes through the shared Web Crypto helpers in auth/signing.ts —
 * the module whose own header warns that a second copy of signing logic
 * drifts and then silently accepts a cookie it should reject. This used to
 * be that second copy (node:crypto, byte-identical output); now there is one.
 */

export async function signSessionId(id: string): Promise<string> {
  return signValue(id, env.SESSION_SECRET);
}

/** Returns the id only when the signature checks out. */
export async function verifySessionCookie(
  value: string | undefined,
): Promise<string | null> {
  const id = await verifySignedValue(value, env.SESSION_SECRET);
  // The prefix check keeps a signed value from some other cookie family from
  // ever being taken for a session id.
  return id !== null && id.startsWith("sess_") ? id : null;
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
  const existing = await verifySessionCookie(store.get(SESSION_COOKIE)?.value);
  if (existing) return existing;

  const id = newSessionId();
  store.set(SESSION_COOKIE, await signSessionId(id), {
    httpOnly: true,
    secure: USE_SECURE_COOKIE,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });

  return id;
}
