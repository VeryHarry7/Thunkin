import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { err, type ApiResult } from "@/lib/contracts";
import { env } from "@/lib/env";
import { secretsEqual } from "./signing";
import {
  UNLOCK_COOKIE,
  UNLOCK_MAX_AGE_SECONDS,
  mintUnlockValue,
  verifyUnlockValue,
} from "./unlock-cookie";

/**
 * The passphrase gate, bound to the environment.
 *
 * One shared secret is the entire access boundary for this service. That is
 * proportionate — it runs on a home network and the only thing behind it is
 * your own generations — but it is worth being clear-eyed: anyone on the
 * network who has the passphrase can spend money on `FAL_KEY`.
 *
 * The cookie mechanics live in `unlock-cookie.ts`, which takes secrets as
 * arguments so Edge middleware can share them without dragging in the env
 * contract. This module is the Node-side wrapper that reads `env`.
 */

export { UNLOCK_COOKIE, UNLOCK_MAX_AGE_SECONDS };

export async function mintUnlockCookie(now: Date = new Date()): Promise<string> {
  return mintUnlockValue(env.SESSION_SECRET, env.APP_PASSPHRASE, now);
}

/** True when the cookie is validly signed, unexpired, and minted under the current passphrase. */
export async function isUnlocked(cookieValue: string | undefined): Promise<boolean> {
  return verifyUnlockValue(cookieValue, env.SESSION_SECRET, env.APP_PASSPHRASE);
}

/** Constant-time passphrase check that does not leak the passphrase's length. */
export async function passphraseMatches(candidate: string): Promise<boolean> {
  return secretsEqual(candidate, env.APP_PASSPHRASE);
}

/**
 * Defense in depth for private route handlers.
 *
 * Middleware already gates everything, but a gate with a single hinge fails
 * completely when that hinge does — one typo in the exemption list, or a
 * framework bypass, and every route is open. Each private handler calls this
 * first, so a middleware failure degrades to "two checks agree" rather than
 * "no check at all". Returns the same 401 the middleware would, or null to
 * proceed.
 */
export async function requireUnlocked(): Promise<NextResponse<
  ApiResult<never>
> | null> {
  const jar = await cookies();
  if (await isUnlocked(jar.get(UNLOCK_COOKIE)?.value)) return null;

  return NextResponse.json(err("NO_KEY", "Locked."), { status: 401 });
}

/* ========================================================================
 * Attempt limiting
 *
 * One global bucket, deliberately not keyed on anything the caller sends.
 * The previous version keyed on `x-forwarded-for`, which — with no proxy in
 * front of this service — is entirely attacker-supplied: rotating it per
 * request bought unlimited guesses. A single-user service has no legitimate
 * concurrent-strangers case to distinguish, so one bucket is not a
 * compromise; it is the correct shape. Memory is bounded by construction.
 * ===================================================================== */

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60_000;

let failures: { count: number; firstAt: number } | null = null;

export function attemptsRemaining(now: number = Date.now()): number {
  if (!failures || now - failures.firstAt > WINDOW_MS) return MAX_ATTEMPTS;
  return Math.max(0, MAX_ATTEMPTS - failures.count);
}

export function recordFailedAttempt(now: number = Date.now()): void {
  if (!failures || now - failures.firstAt > WINDOW_MS) {
    failures = { count: 1, firstAt: now };
    return;
  }
  failures.count += 1;
}

/** A correct passphrase clears the record — you are evidently not an attacker. */
export function clearAttempts(): void {
  failures = null;
}

/** Test seam. */
export function resetAttempts(): void {
  failures = null;
}
