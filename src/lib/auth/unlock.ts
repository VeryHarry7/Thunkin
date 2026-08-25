import { env } from "@/lib/env";
import { signValue, timingSafeEqualString, verifySignedValue } from "./signing";

/**
 * The passphrase gate.
 *
 * One shared secret is the entire access boundary for this service. That is
 * proportionate — it runs on a home network and the only thing behind it is
 * your own generations — but it is worth being clear-eyed: anyone on the
 * network who has the passphrase can spend money on `FAL_KEY`.
 */

export const UNLOCK_COOKIE = "thunkin_unlocked";

/** A year. You should not have to think about this again once you are in. */
export const UNLOCK_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The cookie payload.
 *
 * Includes a hash-free marker plus the issue time, so the value is not simply
 * a constant string that could be lifted from one device and replayed forever
 * without any record of when it was minted.
 */
function payload(now: Date): string {
  return `unlocked:${now.getTime()}`;
}

export async function mintUnlockCookie(now: Date = new Date()): Promise<string> {
  return signValue(payload(now), env.SESSION_SECRET);
}

/** True when the cookie carries a valid signature from this deployment. */
export async function isUnlocked(cookieValue: string | undefined): Promise<boolean> {
  const value = await verifySignedValue(cookieValue, env.SESSION_SECRET);
  return value !== null && value.startsWith("unlocked:");
}

/** Constant-time passphrase check. */
export function passphraseMatches(candidate: string): boolean {
  return timingSafeEqualString(candidate, env.APP_PASSPHRASE);
}

/* ========================================================================
 * Attempt limiting
 *
 * A single long-running process makes this trivial — one Map, no Redis, no
 * table. It turns a guessable passphrase from "eventually" into "not by brute
 * force", which is the only thing rate limiting can honestly promise.
 * ===================================================================== */

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60_000;

interface Attempts {
  count: number;
  firstAt: number;
}

const attempts = new Map<string, Attempts>();

export function attemptsRemaining(ip: string, now: number = Date.now()): number {
  const record = attempts.get(ip);
  if (!record || now - record.firstAt > WINDOW_MS) return MAX_ATTEMPTS;
  return Math.max(0, MAX_ATTEMPTS - record.count);
}

export function recordFailedAttempt(ip: string, now: number = Date.now()): void {
  const record = attempts.get(ip);
  if (!record || now - record.firstAt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAt: now });
    return;
  }
  record.count += 1;
}

/** A correct passphrase clears the record — you are evidently not an attacker. */
export function clearAttempts(ip: string): void {
  attempts.delete(ip);
}

/** Test seam. */
export function resetAttempts(): void {
  attempts.clear();
}
