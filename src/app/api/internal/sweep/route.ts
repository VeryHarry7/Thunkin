import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sweep } from "@/lib/jobs/sweeper";

export const dynamic = "force-dynamic";

/**
 * The reconciler endpoint.
 *
 * The in-process loop in `src/lib/jobs/sweeper.ts` is what normally drives
 * reconciliation; this endpoint exists so you can poke it by hand when
 * something looks stuck. Both call the same `sweep()`.
 *
 * It is exempt from the passphrase gate because `SWEEP_SECRET` is its
 * credential — a caller here is a script, not a browser, and has no cookie.
 */

function authorized(request: Request): boolean {
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("secret") ??
    "";

  const a = Buffer.from(provided);
  const b = Buffer.from(env.SWEEP_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const limitParam = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  const result = await sweep(limit ? { limit } : {});
  return NextResponse.json({ ok: true, ...result });
}

/** Some schedulers only issue POST. Same behaviour. */
export const POST = GET;
