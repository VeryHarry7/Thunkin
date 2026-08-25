/**
 * Can anything on the internet actually reach us?
 *
 * This app is built to run on a home network, where the answer is no. That
 * matters for exactly one thing: fal's webhook. fal drops deliveries to
 * private addresses **permanently** and does not follow redirects, so handing
 * it a LAN URL buys roughly 31 failed retries per job across an hour — load on
 * someone else's infrastructure, in exchange for nothing.
 *
 * When we are unreachable we simply do not ask for a webhook. The sweeper is
 * the completion path either way; it was built for precisely this case and the
 * integration suite proves a job reaching `ready` with no webhook at all.
 */

/** Hostnames that resolve inside a network rather than on the internet. */
function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // mDNS and the conventional home-router suffixes.
  if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home")) {
    return true;
  }

  // IPv6 loopback and unique-local / link-local ranges.
  if (host === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe80:/i.test(host)) return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;

  const [a, b] = [Number(v4[1]), Number(v4[2])];

  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, incl. Tailscale
  if (a === 0) return true;

  return false;
}

/** True when a provider could plausibly POST a webhook to this origin. */
export function isPubliclyReachable(origin: string): boolean {
  try {
    return !isPrivateHostname(new URL(origin).hostname);
  } catch {
    // An unparseable origin is not something to send a provider.
    return false;
  }
}

/**
 * The webhook URL to hand the provider, or null when it could not be delivered.
 *
 * Null is not a degraded mode — it is the expected answer on a home network.
 */
export function webhookUrlFor(origin: string): string | null {
  return isPubliclyReachable(origin) ? `${origin}/api/webhooks/fal` : null;
}
