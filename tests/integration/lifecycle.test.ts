import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { closeDb, databaseAvailable, pushSchema, truncateAll } from "./harness";
import { resetMockProvider } from "@/lib/provider";
import { resetPorts, setPortsForTesting } from "@/lib/ports";
import { handleWebhook, submitJob } from "@/lib/jobs/service";
import { sweep } from "@/lib/jobs/sweeper";
import { claimDueJobs, getJob, listJobEvents } from "@/lib/jobs/repo";

/**
 * The scenarios that decide whether "zero orphaned jobs" is true.
 *
 * These run against a real Postgres because the machinery under test —
 * transactions, row locks, `FOR UPDATE SKIP LOCKED` — has no meaningful
 * behaviour against a fake.
 */

const SESSION = "sess_integration";
const KEY = "abc12345:def67890";
const T0 = new Date("2026-08-25T12:00:00Z");

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

if (!available) {
  console.warn(
    "\n  Integration tests skipped: no database at DATABASE_URL.\n" +
      "  Start one with ./scripts/dev-db.sh start\n",
  );
}

/** Advances only the clock. The pg driver's own timers must stay real. */
function at(offsetMs: number): void {
  vi.setSystemTime(new Date(T0.getTime() + offsetMs));
}

describeDb("job lifecycle", () => {
  beforeAll(() => {
    pushSchema();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await truncateAll();
    resetMockProvider();
    setPortsForTesting({
      keyResolver: { getKeyForSession: async () => KEY },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    at(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPorts();
  });

  it("1 — reaches ready when the webhook arrives", async () => {
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params: { prompt: "a lighthouse at dusk" },
    });

    expect(job.status).toBe("queued");
    expect(job.falRequestId).toBeTruthy();

    // The provider finishes, then calls us back.
    at(3_000);
    const advanced = await handleWebhook(job.falRequestId!);

    expect(advanced?.status).toBe("ready");
    expect(advanced?.completedAt).not.toBeNull();
  });

  it("2 — reaches ready with no webhook at all, via the sweeper", async () => {
    // The headline claim. fal drops deliveries to private IPs permanently, so
    // this is the path that runs in every environment where webhooks break.
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params: { prompt: "a lighthouse at dusk" },
    });

    at(3_000);
    const result = await sweep();

    expect(result.claimed).toBe(1);
    expect(result.settled).toBe(1);

    const settled = await getJob(job.id, SESSION);
    expect(settled?.status).toBe("ready");
  });

  it("3 — absorbs a replayed webhook without duplicating anything", async () => {
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params: { prompt: "a lighthouse at dusk" },
    });

    at(3_000);
    await handleWebhook(job.falRequestId!);
    await handleWebhook(job.falRequestId!);
    await handleWebhook(job.falRequestId!);

    const settled = await getJob(job.id, SESSION);
    expect(settled?.status).toBe("ready");

    // One real completion means exactly one ready event, however many
    // deliveries arrived.
    const events = await listJobEvents(job.id);
    const readyEvents = events.filter((event) => event.toStatus === "ready");
    expect(readyEvents).toHaveLength(1);
  });

  it("4 — claims each job exactly once across concurrent sweeps", async () => {
    // SKIP LOCKED is what makes cron overlap and the piggyback sweep safe.
    for (let i = 0; i < 6; i++) {
      await submitJob({
        sessionId: SESSION,
        lookId: "seed-image",
        params: { prompt: `a lighthouse ${i}` },
        idempotencyKey: `idem_${i}`,
      });
    }

    // Past the first scheduled poll at T+2s, so every job is genuinely due.
    at(3_000);

    const [first, second] = await Promise.all([
      claimDueJobs(10, undefined, new Date()),
      claimDueJobs(10, undefined, new Date()),
    ]);

    const ids = [...first, ...second].map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it("5 — expires a stalled job at its ceiling, and not before", async () => {
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params: { prompt: "!stall a lighthouse that never finishes" },
    });

    // Nine minutes in: still inside the ten-minute image ceiling.
    at(9 * 60_000);
    await sweep();
    expect((await getJob(job.id, SESSION))?.status).not.toBe("expired");

    // Eleven minutes: past it.
    at(11 * 60_000);
    await sweep();

    const expired = await getJob(job.id, SESSION);
    expect(expired?.status).toBe("expired");
    expect(expired?.errorCode).toBe("TIMEOUT");
  });

  it("6 — collapses a double submit sharing one idempotency key", async () => {
    const params = { prompt: "a lighthouse at dusk" };

    const first = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params,
      idempotencyKey: "idem_double_tap",
    });
    const second = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params,
      idempotencyKey: "idem_double_tap",
    });

    // Two provider requests would bill the visitor twice for one intent.
    expect(second.id).toBe(first.id);
    expect(second.falRequestId).toBe(first.falRequestId);
  });
});

describeDb("failure handling", () => {
  beforeAll(() => {
    pushSchema();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await truncateAll();
    resetMockProvider();
    setPortsForTesting({
      keyResolver: { getKeyForSession: async () => KEY },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    at(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPorts();
  });

  it("carries a provider failure through to the job's error code", async () => {
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params: { prompt: "!fail:CONTENT_REJECTED a forbidden thing" },
    });

    at(3_000);
    await sweep();

    const failed = await getJob(job.id, SESSION);
    expect(failed?.status).toBe("failed");
    expect(failed?.errorCode).toBe("CONTENT_REJECTED");
    expect(failed?.errorMessage).toBeTruthy();
  });

  it("fails rather than orphaning a job whose key has gone", async () => {
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params: { prompt: "a lighthouse at dusk" },
    });

    // The visitor forgot their key between submit and completion.
    setPortsForTesting({ keyResolver: { getKeyForSession: async () => null } });

    at(3_000);
    await sweep();

    const failed = await getJob(job.id, SESSION);
    expect(failed?.status).toBe("failed");
    expect(failed?.errorCode).toBe("INVALID_KEY");
  });

  it("refuses to submit without a key, before creating provider work", async () => {
    setPortsForTesting({ keyResolver: { getKeyForSession: async () => null } });

    await expect(
      submitJob({
        sessionId: SESSION,
        lookId: "seed-image",
        params: { prompt: "a lighthouse" },
      }),
    ).rejects.toMatchObject({ code: "NO_KEY" });
  });

  it("rejects an unknown look without touching the provider", async () => {
    await expect(
      submitJob({
        sessionId: SESSION,
        lookId: "no-such-look",
        params: { prompt: "a lighthouse" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("never leaves a job non-terminal once it has settled", async () => {
    // The invariant behind the whole workstream, stated as a test.
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params: { prompt: "a lighthouse at dusk" },
    });

    at(3_000);
    await sweep();

    // Further sweeps and late webhooks must not disturb a settled job.
    const settled = await getJob(job.id, SESSION);
    await sweep();
    await handleWebhook(job.falRequestId!);

    const after = await getJob(job.id, SESSION);
    expect(after?.status).toBe(settled?.status);
    expect(after?.completedAt).toEqual(settled?.completedAt);
  });
});

describeDb("session scoping", () => {
  beforeAll(() => {
    pushSchema();
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await truncateAll();
    resetMockProvider();
    setPortsForTesting({
      keyResolver: { getKeyForSession: async () => KEY },
    });
  });

  afterEach(() => {
    resetPorts();
  });

  it("hides another session's job entirely", async () => {
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params: { prompt: "a lighthouse at dusk" },
    });

    // Not an authorization error the caller can distinguish — simply absent.
    expect(await getJob(job.id, "sess_someone_else")).toBeNull();
    expect(await getJob(job.id, SESSION)).not.toBeNull();
  });

  it("lets two sessions reuse the same idempotency key independently", async () => {
    const params = { prompt: "a lighthouse at dusk" };

    const mine = await submitJob({
      sessionId: SESSION,
      lookId: "seed-image",
      params,
      idempotencyKey: "shared",
    });
    const theirs = await submitJob({
      sessionId: "sess_other",
      lookId: "seed-image",
      params,
      idempotencyKey: "shared",
    });

    expect(theirs.id).not.toBe(mine.id);
  });
});
