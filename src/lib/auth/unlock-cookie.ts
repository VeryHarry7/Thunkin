import { sign, signValue, timingSafeEqualString, verifySignedValue } from "./signing";

/**
 * The unlock cookie, as pure functions.
 *
 * This module is what Edge middleware verifies with, so it must not import
 * `@/lib/env` — the env contract validates a Node-shaped environment
 * (DATABASE_URL and friends) that has no business crashing the gate. Secrets
 * arrive as arguments; the Node side wraps them from `env` in `unlock.ts`.
 *
 * Payload format (the value `signValue` wraps):
 *
 *   unlocked.v2.<issuedAtMs>.<ppTag>
 *
 * `ppTag` is the first 16 base64url chars of HMAC(SESSION_SECRET, passphrase
 * material). Binding a tag of the passphrase into the payload is what makes
 * rotating `APP_PASSPHRASE` revoke every issued cookie — without it, a cookie
 * lifted from one device would outlive any number of passphrase changes.
 * The issue time is checked against max age on every request, so the one-year
 * lifetime is enforced by the server rather than politely suggested to the
 * browser.
 */

export const UNLOCK_COOKIE = "thunkin_unlocked";

/** A year. You should not have to think about this again once you are in. */
export const UNLOCK_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** How far in the future an issue time may claim to be — clock-skew allowance. */
const FUTURE_SKEW_MS = 60_000;

const VERSION = "unlocked.v2";
const TAG_LENGTH = 16;

/** The passphrase's short fingerprint under this deployment's secret. */
async function passphraseTag(secret: string, passphrase: string): Promise<string> {
  // A fixed prefix keeps this HMAC from ever colliding with a cookie
  // signature over the same secret.
  return (await sign(`thunkin-pp:${passphrase}`, secret)).slice(0, TAG_LENGTH);
}

/** Mints the full signed cookie value. */
export async function mintUnlockValue(
  secret: string,
  passphrase: string,
  now: Date = new Date(),
): Promise<string> {
  const tag = await passphraseTag(secret, passphrase);
  return signValue(`${VERSION}.${now.getTime()}.${tag}`, secret);
}

/** True only for a validly signed, unexpired cookie minted under the current passphrase. */
export async function verifyUnlockValue(
  cookieValue: string | undefined,
  secret: string,
  passphrase: string,
  now: Date = new Date(),
): Promise<boolean> {
  const value = await verifySignedValue(cookieValue, secret);
  if (value === null) return false;

  const parts = value.split(".");
  if (parts.length !== 4 || `${parts[0]}.${parts[1]}` !== VERSION) return false;

  const issuedAt = Number(parts[2]);
  if (!Number.isFinite(issuedAt)) return false;

  const age = now.getTime() - issuedAt;
  if (age < -FUTURE_SKEW_MS || age > UNLOCK_MAX_AGE_SECONDS * 1000) return false;

  const expected = await passphraseTag(secret, passphrase);
  return timingSafeEqualString(parts[3] ?? "", expected);
}
