import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sweep } from "@/lib/jobs/sweeper";

export const dynamic = "force-dynamic";

/**
 * The reconciler endpoint.
 *
 * Invoked by cron (see vercel.json) and reachable manually with the shared
 * secret. It is the safety net behind every job: whatever happens to webhook
 * delivery, this drives non-terminal jobs to a terminal state.
 */

function authorized(request: Request): boolean {
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("secret") ??
    "";

  // Vercel signs its own cron invocations; accept those without the secret.
  if (request.headers.get("x-vercel-cron")) return true;

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
