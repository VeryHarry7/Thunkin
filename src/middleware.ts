import { NextResponse, type NextRequest } from "next/server";
import { UNLOCK_COOKIE, verifyUnlockValue } from "@/lib/auth/unlock-cookie";

/**
 * The passphrase gate.
 *
 * Runs on the Edge runtime, so it imports only `unlock-cookie.ts` and the Web
 * Crypto signing helpers — never `@/lib/env`, whose Node-shaped validation
 * (DATABASE_URL and friends) has no business crashing the gate. Secrets are
 * read from `process.env` directly.
 *
 * Everything is closed by default. The exemptions below are deliberate and
 * short; adding to that list is how a gate quietly stops being one.
 */

/**
 * Paths that must work without a cookie, and why each one has to.
 *
 * Exported for its unit tests: this table is the whole access boundary, and a
 * boundary nobody tests is a boundary nobody notices breaking.
 */
export function isExempt(pathname: string): boolean {
  // Prefix exemptions on a path that still contains traversal or an encoded
  // dot/slash are the classic bypass shape (`/looks/%2e%2e/api/jobs`). Next
  // normalizes before matching routes, but this check must not depend on that:
  // anything that even looks like an escape is simply not exempt.
  if (pathname.includes("..") || /%2e|%2f|%5c/i.test(pathname)) return false;

  // fal authenticates with an ED25519 signature over the request body, which
  // is a stronger proof than any cookie — and it will never have a cookie to
  // send. Verification happens inside the route itself.
  if (pathname === "/api/webhooks/fal") return true;

  // The reconciler poke carries SWEEP_SECRET, which it checks itself. Like the
  // webhook, it is called by a script or a scheduler that has no cookie to
  // send — and a 32-character random secret is a stronger credential than the
  // passphrase would be anyway.
  if (pathname === "/api/internal/sweep") return true;

  // The gate itself, or there is no way through it.
  if (pathname === "/unlock" || pathname === "/api/unlock") return true;

  // Committed sample images and mock fixtures — nothing private, and the mock
  // ingest path fetches /fixtures/ back through PUBLIC_URL with no cookie.
  // (Build output under /_next/static and /_next/image is excluded by the
  // matcher below; no broader /_next/ exemption exists on purpose.)
  if (pathname.startsWith("/looks/") || pathname.startsWith("/fixtures/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/manifest.webmanifest") return true;

  return false;
}

/**
 * Whether the request's Host header is one this deployment answers to.
 *
 * A hostile web page can DNS-rebind its own domain onto this box's LAN
 * address and then read the API as same-origin — the one remote attack that
 * survives "the attacker is not on your network". Binding to the configured
 * host (plus loopback for dev) closes it. Unset or unparseable PUBLIC_URL
 * skips the check rather than locking the owner out of a misconfigured box.
 */
function hostAllowed(
  hostHeader: string | null,
  publicUrl: string | undefined,
): boolean {
  if (!publicUrl) return true;

  let expected: URL;
  try {
    expected = new URL(publicUrl);
  } catch {
    return true;
  }

  if (!hostHeader) return false;
  if (hostHeader === expected.host) return true;

  // Loopback names on any port keep `pnpm dev` and the e2e server reachable
  // regardless of which of the interchangeable local names the browser used.
  const hostname = hostHeader.replace(/:\d+$/, "");
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!hostAllowed(request.headers.get("host"), process.env.PUBLIC_URL)) {
    return new NextResponse("Wrong host.", { status: 403 });
  }

  if (isExempt(pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  const passphrase = process.env.APP_PASSPHRASE;
  if (!secret || !passphrase) {
    // Refuse rather than fail open. Missing secrets mean we cannot verify
    // anything, and serving the app anyway would be the worst possible answer.
    return new NextResponse("Server is not configured.", { status: 500 });
  }

  const cookie = request.cookies.get(UNLOCK_COOKIE)?.value;
  if (await verifyUnlockValue(cookie, secret, passphrase)) {
    return NextResponse.next();
  }

  // An API call gets a status it can act on; a page gets sent to the gate.
  // Redirecting an API call would hand the client an HTML login page where it
  // expected JSON, which is a confusing way to say "unauthorized".
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: { code: "NO_KEY", message: "Locked." } },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  // Remember where they were headed so unlocking lands them there.
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's static build output; the exemption list above
  // does the rest of the work, in one place where it can be read and audited.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
