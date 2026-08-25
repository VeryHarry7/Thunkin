import { NextResponse, type NextRequest } from "next/server";
import { UNLOCK_COOKIE } from "@/lib/auth/unlock";
import { verifySignedValue } from "@/lib/auth/signing";

/**
 * The passphrase gate.
 *
 * Runs on the Edge runtime, so it cannot import `@/lib/env` (which validates a
 * Node-shaped environment) or Node's `crypto`. It reads `SESSION_SECRET`
 * directly and verifies with Web Crypto instead.
 *
 * Everything is closed by default. The exemptions below are deliberate and
 * short; adding to that list is how a gate quietly stops being one.
 */

/** Paths that must work without a cookie, and why each one has to. */
function isExempt(pathname: string): boolean {
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

  // Static assets and build output. These carry nothing private, and blocking
  // them would leave the unlock page unstyled.
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/looks/") || pathname.startsWith("/fixtures/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/manifest.webmanifest") return true;

  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isExempt(pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // Refuse rather than fail open. A missing secret means we cannot verify
    // anything, and serving the app anyway would be the worst possible answer.
    return new NextResponse("Server is not configured.", { status: 500 });
  }

  const value = await verifySignedValue(
    request.cookies.get(UNLOCK_COOKIE)?.value,
    secret,
  );

  if (value?.startsWith("unlocked:")) return NextResponse.next();

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
  // Everything except Next's internals; the exemption list above does the rest
  // of the work, in one place where it can be read and audited.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
