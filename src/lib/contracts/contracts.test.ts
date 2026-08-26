import { describe, it, expect } from "vitest";
import {
  ApiJob,
  ContractViolation,
  GenerationParams,
  Job,
  JobStatus,
  TERMINAL_STATUSES,
  apiResultSchema,
  err,
  isTerminal,
  issuesToFields,
  ok,
  toApiJob,
  parseOrThrow,
} from "./index";
import { z } from "zod";

describe("JobStatus", () => {
  it("classifies exactly the four terminal states", () => {
    const terminal = JobStatus.options.filter(isTerminal);
    expect(terminal.sort()).toEqual([...TERMINAL_STATUSES].sort());
  });

  it("treats every in-flight state as non-terminal", () => {
    for (const status of [
      "draft",
      "submitting",
      "queued",
      "running",
      "ingesting",
    ] as const) {
      expect(isTerminal(status)).toBe(false);
    }
  });
});

describe("GenerationParams", () => {
  it("accepts a minimal prompt-only request", () => {
    const parsed = GenerationParams.parse({ prompt: "a lighthouse at dusk" });
    expect(parsed.prompt).toBe("a lighthouse at dusk");
    expect(parsed.seed).toBeUndefined();
  });

  it("rejects an empty prompt", () => {
    expect(GenerationParams.safeParse({ prompt: "" }).success).toBe(false);
  });

  it("rejects a negative seed, which no model accepts", () => {
    const result = GenerationParams.safeParse({ prompt: "x", seed: -1 });
    expect(result.success).toBe(false);
  });
});

describe("parseOrThrow", () => {
  it("returns parsed data on success", () => {
    expect(parseOrThrow(z.object({ a: z.number() }), { a: 1 })).toEqual({ a: 1 });
  });

  it("throws a labelled ContractViolation carrying the issues", () => {
    try {
      parseOrThrow(z.object({ a: z.number() }), { a: "no" }, "webhook payload");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ContractViolation);
      const violation = error as ContractViolation;
      expect(violation.message).toContain("webhook payload");
      expect(violation.issues).toHaveLength(1);
    }
  });
});

describe("issuesToFields", () => {
  it("keeps the first message per field rather than stacking them", () => {
    const result = z
      .object({ prompt: z.string().min(5), seed: z.number() })
      .safeParse({ prompt: "hi", seed: "nope" });

    expect(result.success).toBe(false);
    if (result.success) return;

    const fields = issuesToFields(result.error.issues);
    expect(Object.keys(fields).sort()).toEqual(["prompt", "seed"]);
  });
});

describe("ApiResult", () => {
  it("round-trips the success arm through its schema", () => {
    const schema = apiResultSchema(z.object({ jobId: z.string() }));
    expect(schema.parse(ok({ jobId: "job_1" }))).toEqual({
      ok: true,
      data: { jobId: "job_1" },
    });
  });

  it("round-trips the failure arm, including field detail", () => {
    const schema = apiResultSchema(z.unknown());
    const failure = err("BAD_REQUEST", "Check the prompt.", { prompt: "Too short." });
    const parsed = schema.parse(failure);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("BAD_REQUEST");
    expect(parsed.error.fields).toEqual({ prompt: "Too short." });
  });

  it("reuses job error codes so a failure means the same thing everywhere", () => {
    const schema = apiResultSchema(z.unknown());
    expect(schema.parse(err("INVALID_KEY", "That key was rejected.")).ok).toBe(false);
  });
});

describe("Job", () => {
  it("accepts a freshly created draft with nothing provider-side yet", () => {
    const now = new Date();
    const job = Job.parse({
      id: "job_1",
      sessionId: "sess_1",
      kind: "image",
      lookId: "cinematic-portrait",
      modelId: "fal-ai/flux-2/pro",
      params: { prompt: "a lighthouse at dusk" },
      status: "draft",
      falRequestId: null,
      queuePosition: null,
      errorCode: null,
      errorMessage: null,
      attempt: 0,
      idempotencyKey: "idem_1",
      createdAt: now,
      submittedAt: null,
      startedAt: null,
      completedAt: null,
      nextPollAt: null,
    });

    expect(job.status).toBe("draft");
    expect(isTerminal(job.status)).toBe(false);
  });
});

describe("ApiJob", () => {
  const job = Job.parse({
    id: "job_1",
    sessionId: "sess_secret",
    kind: "image" as const,
    lookId: "cinematic-portrait",
    modelId: "fal-ai/flux-2/pro",
    params: { prompt: "a lighthouse at dusk" },
    status: "ready" as const,
    falRequestId: "req_secret",
    queuePosition: null,
    errorCode: null,
    errorMessage: "x".repeat(500),
    attempt: 2,
    idempotencyKey: "idem_secret",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    submittedAt: new Date("2026-01-01T00:00:01Z"),
    startedAt: null,
    completedAt: new Date("2026-01-01T00:00:30Z"),
    nextPollAt: null,
  });

  it("omits every piece of server bookkeeping", () => {
    const wire = toApiJob(job);
    for (const secret of [
      "sessionId",
      "falRequestId",
      "idempotencyKey",
      "attempt",
      "nextPollAt",
    ]) {
      expect(secret in wire, secret).toBe(false);
    }
  });

  it("serializes dates as ISO strings and caps the error message", () => {
    const wire = toApiJob(job);
    expect(wire.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(wire.startedAt).toBeNull();
    expect(wire.errorMessage).toHaveLength(300);
  });

  it("survives an actual JSON round-trip against its own schema", () => {
    // The whole point of the schema: it describes what JSON delivers, so
    // parsing what JSON delivers must succeed.
    const wire = JSON.parse(JSON.stringify(toApiJob(job)));
    expect(ApiJob.parse(wire)).toEqual(toApiJob(job));
  });
});
