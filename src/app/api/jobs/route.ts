import { NextResponse } from "next/server";
import { z } from "zod";
import {
  GenerationParams,
  err,
  issuesToFields,
  ok,
  toApiJob,
  type ApiResult,
  type ApiJobWithAssets,
} from "@/lib/contracts";
import { requireSessionId } from "@/lib/session";
import { ServiceError, submitJob } from "@/lib/jobs/service";
import { listJobs } from "@/lib/jobs/repo";
import { assetsForJobs } from "@/lib/assets/repo";
import { maybeSweep } from "@/lib/jobs/sweeper";
import { requireUnlocked } from "@/lib/auth/unlock";

export const dynamic = "force-dynamic";

const SubmitBody = z.object({
  lookId: z.string().min(1),
  params: GenerationParams,
  idempotencyKey: z.string().min(1).max(200).optional(),
});

/** Creates and submits a generation. */
export async function POST(
  request: Request,
): Promise<NextResponse<ApiResult<ApiJobWithAssets>>> {
  const locked = await requireUnlocked();
  if (locked) return locked;

  const sessionId = await requireSessionId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(err("BAD_REQUEST", "Expected a JSON body."), {
      status: 400,
    });
  }

  const parsed = SubmitBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err(
        "BAD_REQUEST",
        "Check the highlighted fields.",
        issuesToFields(parsed.error.issues),
      ),
      { status: 400 },
    );
  }

  try {
    const job = await submitJob({
      sessionId,
      lookId: parsed.data.lookId,
      params: parsed.data.params,
      ...(parsed.data.idempotencyKey
        ? { idempotencyKey: parsed.data.idempotencyKey }
        : {}),
    });

    // Ordinary traffic doubles as a sweep trigger. Not awaited.
    maybeSweep();

    const assets = await assetsForJobs([job.id]);
    return NextResponse.json(
      ok({ ...toApiJob(job), assets: assets.get(job.id) ?? [] }),
      {
        // A submit that failed on the spot (bad key, provider down) still
        // returns the job — but calling that "201 Created" would be a status
        // lie to any client branching on the code rather than the body.
        status: job.status === "failed" ? 200 : 201,
      },
    );
  } catch (error) {
    if (error instanceof ServiceError) {
      // 401 to match the middleware and unlock route: NO_KEY always means "the
      // credential this needs is not there", whichever layer says it.
      const status = error.code === "NO_KEY" ? 401 : 400;
      return NextResponse.json(err(error.code, error.message), { status });
    }
    throw error;
  }
}

/** This session's jobs, newest first, each with whatever it has produced. */
export async function GET(
  request: Request,
): Promise<NextResponse<ApiResult<ApiJobWithAssets[]>>> {
  const locked = await requireUnlocked();
  if (locked) return locked;

  const sessionId = await requireSessionId();
  const url = new URL(request.url);

  const limit = Number(url.searchParams.get("limit") ?? 30);
  const beforeParam = url.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : undefined;

  const jobs = await listJobs(sessionId, {
    limit: Number.isFinite(limit) ? limit : 30,
    ...(before && !Number.isNaN(before.getTime()) ? { before } : {}),
  });

  maybeSweep();

  // One query for the whole page rather than one per job.
  const assets = await assetsForJobs(jobs.map((job) => job.id));

  return NextResponse.json(
    ok(jobs.map((job) => ({ ...toApiJob(job), assets: assets.get(job.id) ?? [] }))),
  );
}
