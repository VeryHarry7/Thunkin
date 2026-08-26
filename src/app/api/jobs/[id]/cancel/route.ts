import { NextResponse } from "next/server";
import { err, ok, type ApiResult, type Job } from "@/lib/contracts";
import { ownerSessionId } from "@/lib/session";
import { ServiceError, cancelJob } from "@/lib/jobs/service";
import { requireUnlocked } from "@/lib/auth/unlock";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResult<Job>>> {
  const locked = await requireUnlocked();
  if (locked) return locked;

  const { id } = await context.params;
  const sessionId = await ownerSessionId();

  try {
    return NextResponse.json(ok(await cancelJob(id, sessionId)));
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") {
      return NextResponse.json(err("NOT_FOUND", "No such job."), { status: 404 });
    }
    // Cancelling something already finished is not an error worth showing —
    // the machine absorbs it and the job comes back in its terminal state.
    throw error;
  }
}
