import { describe, it, expect } from "vitest";
import { JobStatus, type Job } from "@/lib/contracts";
import {
  IllegalTransition,
  eventForProviderStatus,
  transition,
  type JobEventInput,
} from "./machine";

const NOW = new Date("2026-08-25T12:00:00Z");

function job(
  status: JobStatus,
  overrides: Partial<Pick<Job, "kind" | "startedAt">> = {},
): Pick<Job, "status" | "kind" | "startedAt"> {
  return {
    status,
    kind: overrides.kind ?? "image",
    startedAt: overrides.startedAt ?? null,
  };
}

/** Every event, in a shape valid enough to apply. */
const ALL_EVENTS: JobEventInput[] = [
  { type: "SUBMIT_STARTED" },
  { type: "SUBMIT_ACCEPTED", falRequestId: "req_1" },
  { type: "PROVIDER_QUEUED", queuePosition: 3 },
  { type: "PROVIDER_RUNNING" },
  { type: "PROVIDER_COMPLETED" },
  { type: "INGEST_STARTED" },
  { type: "INGEST_COMPLETED" },
  { type: "FAILED", code: "MODEL_ERROR", message: "boom" },
  { type: "CANCELED" },
  { type: "EXPIRED" },
];

describe("the happy path", () => {
  it("walks draft to ready", () => {
    const steps: Array<[JobStatus, JobEventInput, JobStatus]> = [
      ["draft", { type: "SUBMIT_STARTED" }, "submitting"],
      ["submitting", { type: "SUBMIT_ACCEPTED", falRequestId: "r" }, "queued"],
      ["queued", { type: "PROVIDER_RUNNING" }, "running"],
      ["running", { type: "PROVIDER_COMPLETED" }, "ingesting"],
      ["ingesting", { type: "INGEST_COMPLETED" }, "ready"],
    ];

    for (const [from, event, expected] of steps) {
      const result = transition(job(from), event, NOW);
      expect(result, `${from} + ${event.type}`).not.toBeNull();
      expect(result!.toStatus).toBe(expected);
      expect(result!.fromStatus).toBe(from);
    }
  });
});

describe("the convergence rule", () => {
  it("absorbs a transition into the status a job already holds", () => {
    // The webhook and sweeper race constantly; the loser must be a silent
    // no-op, not an error.
    expect(transition(job("queued"), { type: "PROVIDER_QUEUED" }, NOW)).toBeNull();
    expect(transition(job("running"), { type: "PROVIDER_RUNNING" }, NOW)).toBeNull();
    expect(
      transition(job("ingesting"), { type: "PROVIDER_COMPLETED" }, NOW),
    ).toBeNull();
  });

  it("never resurrects a terminal job, whatever arrives late", () => {
    for (const status of ["ready", "failed", "canceled", "expired"] as const) {
      for (const event of ALL_EVENTS) {
        expect(
          transition(job(status), event, NOW),
          `${status} + ${event.type} must be a no-op`,
        ).toBeNull();
      }
    }
  });
});

describe("illegal transitions", () => {
  it("throws rather than silently accepting a contradiction", () => {
    // A result cannot arrive for a job that was never submitted.
    expect(() => transition(job("draft"), { type: "INGEST_COMPLETED" }, NOW)).toThrow(
      IllegalTransition,
    );

    // Nor can a job be accepted by the provider before it was sent.
    expect(() =>
      transition(job("draft"), { type: "SUBMIT_ACCEPTED", falRequestId: "r" }, NOW),
    ).toThrow(IllegalTransition);

    // Nor can it be submitted twice.
    expect(() => transition(job("queued"), { type: "SUBMIT_STARTED" }, NOW)).toThrow(
      IllegalTransition,
    );
  });

  it("carries the from-status and event on the error", () => {
    try {
      transition(job("draft"), { type: "INGEST_COMPLETED" }, NOW);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransition);
      const illegal = error as IllegalTransition;
      expect(illegal.from).toBe("draft");
      expect(illegal.event).toBe("INGEST_COMPLETED");
    }
  });

  it("covers the full matrix without an unhandled outcome", () => {
    // Every (status, event) pair must either transition, no-op, or throw
    // IllegalTransition. Anything else — a crash, an undefined — is a bug.
    for (const status of JobStatus.options) {
      for (const event of ALL_EVENTS) {
        try {
          const result = transition(job(status), event, NOW);
          if (result !== null) {
            expect(result.toStatus).not.toBe(status);
            expect(JobStatus.options).toContain(result.toStatus);
          }
        } catch (error) {
          expect(error, `${status} + ${event.type}`).toBeInstanceOf(IllegalTransition);
        }
      }
    }
  });
});

describe("interruptions", () => {
  it("lets a failure interrupt from any in-flight status", () => {
    for (const status of [
      "draft",
      "submitting",
      "queued",
      "running",
      "ingesting",
    ] as const) {
      const result = transition(
        job(status),
        { type: "FAILED", code: "NETWORK", message: "lost" },
        NOW,
      );
      expect(result, status).not.toBeNull();
      expect(result!.patch.errorCode).toBe("NETWORK");
      expect(result!.patch.completedAt).toEqual(NOW);
      expect(result!.patch.nextPollAt).toBeNull();
    }
  });

  it("refuses to cancel a job already being ingested", () => {
    // The provider has finished and we are copying the result; cancelling here
    // would strand a paid-for output.
    expect(() => transition(job("ingesting"), { type: "CANCELED" }, NOW)).toThrow(
      IllegalTransition,
    );
  });

  it("expires with the TIMEOUT code and visitor-safe copy", () => {
    const result = transition(job("running"), { type: "EXPIRED" }, NOW);
    expect(result!.patch.errorCode).toBe("TIMEOUT");
    expect(result!.patch.errorMessage).not.toMatch(/null|undefined|Error/);
  });
});

describe("requeue handling", () => {
  it("accepts a job going back to the queue after running", () => {
    // fal can release a runner and requeue; refusing this would strand the job.
    const result = transition(
      job("running", { startedAt: NOW }),
      { type: "PROVIDER_QUEUED", queuePosition: 2 },
      NOW,
    );
    expect(result!.toStatus).toBe("queued");
    expect(result!.patch.queuePosition).toBe(2);
  });

  it("keeps the original start time when a requeued job runs again", () => {
    const firstStart = new Date("2026-08-25T11:59:00Z");
    const result = transition(
      job("queued", { startedAt: firstStart }),
      { type: "PROVIDER_RUNNING" },
      NOW,
    );

    // Elapsed time the visitor watches must not reset mid-wait.
    expect(result!.patch.startedAt).toBeUndefined();
  });

  it("stamps the start time on the first run", () => {
    const result = transition(job("queued"), { type: "PROVIDER_RUNNING" }, NOW);
    expect(result!.patch.startedAt).toEqual(NOW);
  });

  it("clears the queue position once running", () => {
    const result = transition(job("queued"), { type: "PROVIDER_RUNNING" }, NOW);
    expect(result!.patch.queuePosition).toBeNull();
  });
});

describe("purity", () => {
  it("never mutates the job it was given", () => {
    const original = job("queued");
    const snapshot = { ...original };
    transition(original, { type: "PROVIDER_RUNNING" }, NOW);
    expect(original).toEqual(snapshot);
  });
});

describe("eventForProviderStatus", () => {
  it("maps every provider status onto an event", () => {
    expect(eventForProviderStatus("IN_QUEUE", { queuePosition: 4 })).toEqual({
      type: "PROVIDER_QUEUED",
      queuePosition: 4,
    });
    expect(eventForProviderStatus("IN_PROGRESS").type).toBe("PROVIDER_RUNNING");
    expect(eventForProviderStatus("COMPLETED").type).toBe("PROVIDER_COMPLETED");
  });

  it("omits queue position rather than inventing one", () => {
    expect(eventForProviderStatus("IN_QUEUE")).toEqual({ type: "PROVIDER_QUEUED" });
  });

  it("defaults an unexplained failure to MODEL_ERROR, never a generic code", () => {
    const event = eventForProviderStatus("FAILED");
    expect(event).toMatchObject({ type: "FAILED", code: "MODEL_ERROR" });
  });

  it("preserves a specific failure code when the provider gives one", () => {
    const event = eventForProviderStatus("FAILED", {
      code: "CONTENT_REJECTED",
      message: "refused",
    });
    expect(event).toMatchObject({ type: "FAILED", code: "CONTENT_REJECTED" });
  });
});
