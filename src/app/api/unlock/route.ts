import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  UNLOCK_COOKIE,
  UNLOCK_MAX_AGE_SECONDS,
  attemptsRemaining,
  clearAttempts,
  mintUnlockCookie,
  passphraseMatches,
  recordFailedAttempt,
} from "@/lib/auth/unlock";

export const dynamic = "force-dynamic";
// Node runtime: this reads the validated env contract, which middleware cannot.
export const runtime = "nodejs";

/**
 * Identifies a caller for rate limiting.
 *
 * On a LAN this is a real client address rather than a proxy's. Behind a
 * reverse proxy it would need the forwarded header to be trustworthy, which on
 * a home network it effectively is.
 */
function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = callerIp(request);

  if (attemptsRemaining(ip) <= 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Wait a few minutes.",
        },
      },
      { status: 429 },
    );
  }

  let passphrase = "";
  try {
    const body = (await request.json()) as { passphrase?: unknown };
    if (typeof body.passphrase === "string") passphrase = body.passphrase;
  } catch {
    // Fall through to the same rejection as a wrong passphrase — telling a
    // caller their JSON was malformed reveals nothing useful to them and a
    // little to an attacker.
  }

  if (!passphraseMatches(passphrase)) {
    recordFailedAttempt(ip);
    const left = attemptsRemaining(ip);

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NO_KEY",
          message:
            left <= 3
              ? `That's not it. ${left} ${left === 1 ? "try" : "tries"} left.`
              : "That's not it.",
        },
      },
      { status: 401 },
    );
  }

  clearAttempts(ip);

  const response = NextResponse.json({ ok: true, data: { unlocked: true } });
  response.cookies.set(UNLOCK_COOKIE, await mintUnlockCookie(), {
    httpOnly: true,
    // Follows the origin's scheme, not NODE_ENV: a Secure cookie sent over
    // plain HTTP is silently dropped, and this app is expected to run over
    // http on a LAN.
    secure: env.PUBLIC_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: UNLOCK_MAX_AGE_SECONDS,
  });

  return response;
}

/** Sign out — mostly useful for testing the gate still works. */
export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true, data: { unlocked: false } });
  response.cookies.delete(UNLOCK_COOKIE);
  return response;
}
