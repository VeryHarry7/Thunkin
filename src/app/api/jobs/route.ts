import { NextResponse } from "next/server";
import { z } from "zod";
import {
  GenerationParams,
  err,
  issuesToFields,
  ok,
  type ApiResult,
  type Job,
} from "@/lib/contracts";
import { requireSessionId } from "@/lib/session";
import { ServiceError, submitJob } from "@/lib/jobs/service";
import { listJobs } from "@/lib/jobs/repo";
import { maybeSweep } from "@/lib/jobs/sweeper";

export const dynamic = "force-dynamic";

const SubmitBody = z.object({
  lookId: z.string().min(1),
  params: GenerationParams,
  idempotencyKey: z.string().min(1).max(200).optional(),
});

/** Creates and submits a generation. */
export async function POST(request: Request): Promise<NextResponse<ApiResult<Job>>> {
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

    return NextResponse.json(ok(job), { status: 201 });
  } catch (error) {
    if (error instanceof ServiceError) {
      const status = error.code === "NO_KEY" ? 403 : 400;
      return NextResponse.json(err(error.code, error.message), { status });
    }
    throw error;
  }
}

/** This session's jobs, newest first. */
export async function GET(request: Request): Promise<NextResponse<ApiResult<Job[]>>> {
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

  return NextResponse.json(ok(jobs));
}
