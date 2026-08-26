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
import {
  closeDb,
  databaseAvailable,
  getDb,
  pushSchema,
  startFixtureServer,
  stopFixtureServer,
  truncateAll,
} from "./harness";
import { resetMockProvider } from "@/lib/provider";
import { resetPorts, setPortsForTesting } from "@/lib/ports";
import { cancelJob, handleWebhook, submitJob } from "@/lib/jobs/service";
import { sweep } from "@/lib/jobs/sweeper";
import {
  applyTransition,
  claimDueJobs,
  createJob,
  getJob,
  listJobEvents,
  listJobs,
} from "@/lib/jobs/repo";
import { assetsForJobs, getAsset } from "@/lib/assets/repo";
import { deleteJob } from "@/lib/assets/delete";
import { eq } from "drizzle-orm";
import { jobs } from "@/lib/db/tables/jobs";
import { getStorage } from "@/lib/storage";

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
  beforeAll(async () => {
    pushSchema();
    await startFixtureServer();
  });

  afterAll(async () => {
    await stopFixtureServer();
    await closeDb();
  });

  beforeEach(async () => {
    await truncateAll();
    resetMockProvider();
    setPortsForTesting({
      keyResolver: { getKey: async () => KEY },
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
      lookId: "quick-sketch",
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
      lookId: "quick-sketch",
      params: { prompt: "a lighthouse at dusk" },
    });

    at(3_000);
    const result = await sweep();

    expect(result.claimed).toBe(1);
    expect(result.settled).toBe(1);

    const settled = await getJob(job.id);
    expect(settled?.status).toBe("ready");
  });

  it("3 — absorbs a replayed webhook without duplicating anything", async () => {
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params: { prompt: "a lighthouse at dusk" },
    });

    at(3_000);
    await handleWebhook(job.falRequestId!);
    await handleWebhook(job.falRequestId!);
    await handleWebhook(job.falRequestId!);

    const settled = await getJob(job.id);
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
        lookId: "quick-sketch",
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
      lookId: "quick-sketch",
      params: { prompt: "!stall a lighthouse that never finishes" },
    });

    // Nine minutes in: still inside the ten-minute image ceiling.
    at(9 * 60_000);
    await sweep();
    expect((await getJob(job.id))?.status).not.toBe("expired");

    // Eleven minutes: past it.
    at(11 * 60_000);
    await sweep();

    const expired = await getJob(job.id);
    expect(expired?.status).toBe("expired");
    expect(expired?.errorCode).toBe("TIMEOUT");
  });

  it("7 — produces a real asset whose bytes are readable", async () => {
    /*
     * The gap this closes: before the asset pipeline existed, scenario 2 passed
     * with a no-op ingest and *zero* assets. "ready" meant nothing had gone
     * wrong, not that anything had been produced. This asserts the bytes.
     */
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params: { prompt: "a lighthouse at dusk" },
    });

    at(3_000);
    await sweep();

    const settled = await getJob(job.id);
    expect(settled?.status).toBe("ready");

    const produced = await assetsForJobs([job.id]);
    const list = produced.get(job.id) ?? [];
    expect(list).toHaveLength(1);

    const asset = list[0]!;
    expect(asset.width).toBeGreaterThan(0);
    expect(asset.height).toBeGreaterThan(0);
    // Paints before the bytes land, which is the whole point of storing it.
    expect(asset.blurPlaceholder).toMatch(/^data:image\/webp;base64,/);
    // The client gets an opaque route, never a storage path.
    expect(asset.url).toBe(`/api/assets/${asset.id}`);

    const row = await getAsset(asset.id);
    expect(row).not.toBeNull();

    const stored = await getStorage().get(row!.storageKey);
    expect(stored).not.toBeNull();
    expect(stored!.body.byteLength).toBe(row!.bytes);
    expect(stored!.mime).toBe("image/png");
  });

  it("8 — fails the job rather than reporting ready when ingest cannot save", async () => {
    // A result we could not keep must never show as ready: the provider URL
    // expires and the library would carry an entry that renders nothing.
    setPortsForTesting({
      ingestPort: {
        async ingest() {
          throw new Error("storage is down");
        },
      },
    });

    const job = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params: { prompt: "a lighthouse at dusk" },
    });

    at(3_000);
    await sweep();

    const failed = await getJob(job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.errorCode).toBe("INGEST_FAILED");
  });

  it("6 — collapses a double submit sharing one idempotency key", async () => {
    const params = { prompt: "a lighthouse at dusk" };

    const first = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params,
      idempotencyKey: "idem_double_tap",
    });
    const second = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params,
      idempotencyKey: "idem_double_tap",
    });

    // Two provider requests would bill the visitor twice for one intent.
    expect(second.id).toBe(first.id);
    expect(second.falRequestId).toBe(first.falRequestId);
  });
});

describeDb("failure handling", () => {
  beforeAll(async () => {
    pushSchema();
    await startFixtureServer();
  });

  afterAll(async () => {
    await stopFixtureServer();
    await closeDb();
  });

  beforeEach(async () => {
    await truncateAll();
    resetMockProvider();
    setPortsForTesting({
      keyResolver: { getKey: async () => KEY },
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
      lookId: "quick-sketch",
      params: { prompt: "!fail:CONTENT_REJECTED a forbidden thing" },
    });

    at(3_000);
    await sweep();

    const failed = await getJob(job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.errorCode).toBe("CONTENT_REJECTED");
    expect(failed?.errorMessage).toBeTruthy();
  });

  it("fails rather than orphaning a job whose key has gone", async () => {
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params: { prompt: "a lighthouse at dusk" },
    });

    // The key vanished between submit and completion (env change + restart).
    setPortsForTesting({ keyResolver: { getKey: async () => null } });

    at(3_000);
    await sweep();

    const failed = await getJob(job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.errorCode).toBe("INVALID_KEY");
  });

  it("refuses to submit without a key, before creating provider work", async () => {
    setPortsForTesting({ keyResolver: { getKey: async () => null } });

    await expect(
      submitJob({
        sessionId: SESSION,
        lookId: "quick-sketch",
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
      lookId: "quick-sketch",
      params: { prompt: "a lighthouse at dusk" },
    });

    at(3_000);
    await sweep();

    // Further sweeps and late webhooks must not disturb a settled job.
    const settled = await getJob(job.id);
    await sweep();
    await handleWebhook(job.falRequestId!);

    const after = await getJob(job.id);
    expect(after?.status).toBe(settled?.status);
    expect(after?.completedAt).toEqual(settled?.completedAt);
  });
});

describeDb("session scoping", () => {
  beforeAll(async () => {
    pushSchema();
    await startFixtureServer();
  });

  afterAll(async () => {
    await stopFixtureServer();
    await closeDb();
  });

  beforeEach(async () => {
    await truncateAll();
    resetMockProvider();
    setPortsForTesting({
      keyResolver: { getKey: async () => KEY },
    });
  });

  afterEach(() => {
    resetPorts();
  });

  it("still returns null for a job that does not exist", async () => {
    // Unscoped is not the same as unchecked — absence must stay absence.
    expect(await getJob("job_does_not_exist")).toBeNull();
  });

  it("lists jobs made on other devices in one library", async () => {
    /*
     * The phone-and-laptop case. This is a single-user service behind a
     * passphrase, so an unlocked caller is the owner no matter which browser
     * they are in — reads take no session at all. The id is still written on
     * each job as provenance.
     */
    await submitJob({
      sessionId: "sess_laptop",
      lookId: "quick-sketch",
      params: { prompt: "made on the laptop" },
      idempotencyKey: "idem_laptop",
    });
    await submitJob({
      sessionId: "sess_phone",
      lookId: "quick-sketch",
      params: { prompt: "made on the phone" },
      idempotencyKey: "idem_phone",
    });

    const seenFromPhone = await listJobs({ limit: 50 });
    expect(seenFromPhone.map((job) => job.params.prompt).sort()).toEqual([
      "made on the laptop",
      "made on the phone",
    ]);
  });

  it("lets two sessions reuse the same idempotency key independently", async () => {
    const params = { prompt: "a lighthouse at dusk" };

    const mine = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params,
      idempotencyKey: "shared",
    });
    const theirs = await submitJob({
      sessionId: "sess_other",
      lookId: "quick-sketch",
      params,
      idempotencyKey: "shared",
    });

    expect(theirs.id).not.toBe(mine.id);
  });
});

describeDb("orphans, cancellation, deletion", () => {
  beforeAll(async () => {
    pushSchema();
    await startFixtureServer();
  });

  afterAll(async () => {
    await stopFixtureServer();
    await closeDb();
  });

  beforeEach(async () => {
    await truncateAll();
    resetMockProvider();
    setPortsForTesting({
      keyResolver: { getKey: async () => KEY },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    at(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPorts();
  });

  it("expires orphans the claim query can never see", async () => {
    // The crash windows: before SUBMIT_STARTED leaves `draft`, after it but
    // before the provider answers leaves `submitting` — both with no request
    // id, so the poll path is blind to them. Only this pass ends them.
    const draft = await createJob({
      sessionId: SESSION,
      kind: "image",
      lookId: "quick-sketch",
      modelId: "fal-ai/flux/schnell",
      params: { prompt: "stranded before submit" },
      idempotencyKey: "orphan-draft",
    });
    // `createdAt` is a database default and the database's clock is real; pin
    // it to the faked timeline so "created at T0" is actually true.
    await getDb()
      .update(jobs)
      .set({ createdAt: new Date() })
      .where(eq(jobs.id, draft.job.id));

    const submitting = await createJob({
      sessionId: SESSION,
      kind: "image",
      lookId: "quick-sketch",
      modelId: "fal-ai/flux/schnell",
      params: { prompt: "stranded mid-submit" },
      idempotencyKey: "orphan-submitting",
    });
    await applyTransition(submitting.job.id, { type: "SUBMIT_STARTED" }, "client");

    // Young orphans are left alone — a submit in progress looks identical.
    at(1_000);
    const early = await sweep();
    expect(early.expired).toBe(0);

    // Past the image ceiling, both are expired.
    at(700_000);
    const late = await sweep();
    expect(late.expired).toBe(2);

    expect((await getJob(draft.job.id))?.status).toBe("expired");
    expect((await getJob(submitting.job.id))?.status).toBe("expired");
  });

  it("absorbs a cancel that lands during ingest", async () => {
    // CANCELED from `ingesting` is deliberately illegal in the machine — the
    // money is spent, the result is seconds away. The service must absorb
    // that as "too late" rather than escaping as a 500.
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params: { prompt: "a lighthouse at dusk" },
    });

    await applyTransition(job.id, { type: "PROVIDER_RUNNING" }, "system");
    await applyTransition(job.id, { type: "PROVIDER_COMPLETED" }, "system");

    const outcome = await cancelJob(job.id);
    expect(outcome.status).toBe("ingesting");
    expect((await getJob(job.id))?.status).toBe("ingesting");
  });

  it("deleteJob removes the bytes and every row, in that order of importance", async () => {
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params: { prompt: "a lighthouse at dusk" },
    });
    at(3_000);
    await sweep();
    expect((await getJob(job.id))?.status).toBe("ready");

    const publics = (await assetsForJobs([job.id])).get(job.id) ?? [];
    expect(publics.length).toBeGreaterThan(0);
    const asset = await getAsset(publics[0]!.id);
    expect(asset).not.toBeNull();
    expect(await getStorage().get(asset!.storageKey)).not.toBeNull();

    expect(await deleteJob(job.id)).toBe(true);

    // Bytes gone, rows gone, audit trail cascaded.
    expect(await getStorage().get(asset!.storageKey)).toBeNull();
    expect(await getJob(job.id)).toBeNull();
    expect(await getAsset(publics[0]!.id)).toBeNull();
    expect(await listJobEvents(job.id)).toHaveLength(0);
  });
});
