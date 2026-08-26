import { NextResponse } from "next/server";
import {
  err,
  ok,
  toApiJob,
  type ApiResult,
  type ApiJobWithAssets,
} from "@/lib/contracts";
import { ownerSessionId } from "@/lib/session";
import { getJob } from "@/lib/jobs/repo";
import { assetsForJobs } from "@/lib/assets/repo";
import { deleteJob } from "@/lib/assets/delete";
import { maybeSweep } from "@/lib/jobs/sweeper";
import { requireUnlocked } from "@/lib/auth/unlock";

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
): Promise<NextResponse<ApiResult<ApiJobWithAssets>>> {
  const locked = await requireUnlocked();
  if (locked) return locked;

  const { id } = await context.params;
  const sessionId = await ownerSessionId();

  const job = await getJob(id, sessionId);
  if (!job) {
    return NextResponse.json(err("NOT_FOUND", "No such job."), { status: 404 });
  }

  // This is the request a client waiting on a result makes most often, so it is
  // the most valuable place to piggyback a sweep: without it, a visitor polling
  // one job would sit and watch nothing happen until cron next fired.
  maybeSweep();

  const assets = await assetsForJobs([job.id]);
  return NextResponse.json(ok({ ...toApiJob(job), assets: assets.get(job.id) ?? [] }));
}

/** Removes a generation and the bytes it produced. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResult<{ deleted: boolean }>>> {
  const locked = await requireUnlocked();
  if (locked) return locked;

  const { id } = await context.params;
  const sessionId = await ownerSessionId();

  const job = await getJob(id, sessionId);
  if (!job) {
    return NextResponse.json(err("NOT_FOUND", "No such job."), { status: 404 });
  }

  await deleteJob(id);
  return NextResponse.json(ok({ deleted: true }));
}
