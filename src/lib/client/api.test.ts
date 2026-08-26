import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiCallError, deleteJob, getJobs, submitJob } from "./api";

/**
 * The client's half of the wire contract. The server's half is proven by
 * `toApiJob`'s round-trip test; this proves the parser actually stands
 * between the network and the components.
 */

const WIRE_JOB = {
  id: "job_1",
  kind: "image",
  lookId: "quick-sketch",
  modelId: "fal-ai/flux/schnell",
  params: { prompt: "a lighthouse" },
  status: "queued",
  queuePosition: null,
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  submittedAt: "2026-01-01T00:00:01.000Z",
  startedAt: null,
  completedAt: null,
  assets: [],
};

function respond(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client api", () => {
  it("returns parsed data from the ok arm", async () => {
    respond({ ok: true, data: [WIRE_JOB] });
    const jobs = await getJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("throws a typed error from the error arm", async () => {
    respond({ ok: false, error: { code: "NO_KEY", message: "Locked." } }, 401);
    const failure = await submitJob({
      lookId: "quick-sketch",
      params: { prompt: "x" },
      idempotencyKey: "k",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiCallError);
    expect((failure as ApiCallError).code).toBe("NO_KEY");
    expect((failure as ApiCallError).message).toBe("Locked.");
  });

  it("carries field detail on a validation error", async () => {
    respond(
      {
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: "Check the highlighted fields.",
          fields: { prompt: "Too long." },
        },
      },
      400,
    );
    const failure = await submitJob({
      lookId: "quick-sketch",
      params: { prompt: "x" },
      idempotencyKey: "k",
    }).catch((error: unknown) => error);

    expect((failure as ApiCallError).fields).toEqual({ prompt: "Too long." });
  });

  it("refuses a malformed body instead of passing it downstream", async () => {
    // The entire reason this layer exists: a shape drift is an error at the
    // boundary, not an undefined dereference in a component.
    respond({ ok: true, data: [{ id: "job_1", nothing: "else" }] });
    const failure = await getJobs().catch((error: unknown) => error);
    expect((failure as ApiCallError).code).toBe("INTERNAL");
  });

  it("refuses a non-JSON response the same way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>gateway error</html>", { status: 502 })),
    );
    const failure = await getJobs().catch((error: unknown) => error);
    expect((failure as ApiCallError).code).toBe("INTERNAL");
  });

  it("maps an unreachable server to NETWORK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const failure = await deleteJob("job_1").catch((error: unknown) => error);
    expect((failure as ApiCallError).code).toBe("NETWORK");
  });
});
