/**
 * Cookie signing that works in both runtimes.
 *
 * The passphrase gate runs in Edge middleware, where Node's `crypto.createHmac`
 * does not exist. Web Crypto does, and it also exists in Node — so this module
 * uses `crypto.subtle` throughout and both runtimes share one implementation.
 * Two copies of signing logic is exactly the kind of thing that drifts and then
 * silently accepts a cookie it should reject.
 */

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The signature for a value, base64url encoded. */
export async function sign(value: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(value),
  );
  return toBase64Url(signature);
}

/** `<value>.<signature>` — the shape every signed cookie in this app takes. */
export async function signValue(value: string, secret: string): Promise<string> {
  return `${value}.${await sign(value, secret)}`;
}

/**
 * Compares two strings without leaking where they first differ.
 *
 * Length is compared first and non-constant-time, which is fine: signature
 * length is fixed and public, and a passphrase's length is not the secret.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Returns the value only when the signature checks out. */
export async function verifySignedValue(
  cookie: string | undefined,
  secret: string,
): Promise<string | null> {
  if (!cookie) return null;

  const separator = cookie.lastIndexOf(".");
  if (separator <= 0) return null;

  const value = cookie.slice(0, separator);
  const provided = cookie.slice(separator + 1);

  return timingSafeEqualString(provided, await sign(value, secret)) ? value : null;
}
