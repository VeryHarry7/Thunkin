import { NextResponse } from "next/server";
import { err, ok, type ApiResult, type JobWithAssets } from "@/lib/contracts";
import { getSessionId } from "@/lib/session";
import { getJob } from "@/lib/jobs/repo";
import { assetsForJobs } from "@/lib/assets/repo";
import { maybeSweep } from "@/lib/jobs/sweeper";

export const dynamic = "force-dynamic";

/**
 * One job, with whatever it has produced.
 *
 * A job belonging to another session is a **404, never a 403** — a 403 would
 * confirm the id exists, handing an enumerator a working oracle.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResult<JobWithAssets>>> {
  const { id } = await context.params;
  const sessionId = await getSessionId();

  if (!sessionId) {
    return NextResponse.json(err("NOT_FOUND", "No such job."), { status: 404 });
  }

  const job = await getJob(id, sessionId);
  if (!job) {
    return NextResponse.json(err("NOT_FOUND", "No such job."), { status: 404 });
  }

  // This is the request a client waiting on a result makes most often, so it is
  // the most valuable place to piggyback a sweep: without it, a visitor polling
  // one job would sit and watch nothing happen until cron next fired.
  maybeSweep();

  const assets = await assetsForJobs([job.id]);
  return NextResponse.json(ok({ ...job, assets: assets.get(job.id) ?? [] }));
}
