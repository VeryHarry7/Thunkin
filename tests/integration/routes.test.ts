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
  pushSchema,
  startFixtureServer,
  stopFixtureServer,
  truncateAll,
} from "./harness";
import { resetMockProvider } from "@/lib/provider";
import { resetPorts, setPortsForTesting } from "@/lib/ports";
import { submitJob } from "@/lib/jobs/service";
import { sweep } from "@/lib/jobs/sweeper";
import { applyTransition } from "@/lib/jobs/repo";
import { assetsForJobs, getAsset } from "@/lib/assets/repo";
import { getStorage } from "@/lib/storage";
import { mintUnlockCookie, UNLOCK_COOKIE } from "@/lib/auth/unlock";

/**
 * Route handlers driven directly, bytes and headers included.
 *
 * The e2e suite covers these over real HTTP, but only incidentally — nothing
 * there reads an asset's bytes back or checks a Content-Disposition. These
 * tests hold the handlers themselves to their contract.
 *
 * `next/headers` is mocked because there is no request scope here; the jar
 * serves the real signed unlock cookie so `requireUnlocked` runs its actual
 * verification rather than being stubbed out.
 */

let unlockCookie = "";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === UNLOCK_COOKIE && unlockCookie
        ? { name, value: unlockCookie }
        : undefined,
    set: () => {},
  }),
}));

const SESSION = "sess_routes";
const KEY = "abc12345:def67890";
const T0 = new Date("2026-08-25T12:00:00Z");

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

function at(offsetMs: number): void {
  vi.setSystemTime(new Date(T0.getTime() + offsetMs));
}

/** A job driven all the way to ready, with its first public asset. */
async function readyJobWithAsset() {
  const job = await submitJob({
    sessionId: SESSION,
    lookId: "quick-sketch",
    params: { prompt: "a lighthouse at dusk" },
  });
  at(3_000);
  await sweep();

  const publics = (await assetsForJobs([job.id])).get(job.id) ?? [];
  expect(publics.length).toBeGreaterThan(0);
  return { job, asset: publics[0]! };
}

describeDb("the assets route", () => {
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
      keyResolver: { getKeyForSession: async () => KEY },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    at(0);
    // Minted under the faked clock: the cookie's age check would (correctly)
    // reject one issued from the real future.
    unlockCookie = await mintUnlockCookie();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPorts();
  });

  async function getAssetRoute(url: string, id: string) {
    const { GET } = await import("@/app/api/assets/[id]/route");
    return GET(new Request(url), { params: Promise.resolve({ id }) });
  }

  it("serves the exact bytes with honest headers", async () => {
    const { asset } = await readyJobWithAsset();

    const response = await getAssetRoute(
      `http://test.local/api/assets/${asset.id}`,
      asset.id,
    );

    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Number(response.headers.get("content-length"))).toBe(body.byteLength);
    expect(response.headers.get("content-disposition")).toContain("inline");

    // The bytes are the stored bytes — not a slab, not a truncation.
    const row = await getAsset(asset.id, SESSION);
    const stored = await getStorage().get(row!.storageKey);
    expect(body).toEqual(stored!.body);
  });

  it("turns ?download=1 into an attachment with an openable filename", async () => {
    const { asset } = await readyJobWithAsset();

    const response = await getAssetRoute(
      `http://test.local/api/assets/${asset.id}?download=1`,
      asset.id,
    );

    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toMatch(/filename="thunkin-.*\.png"/);
  });

  it("reports missing bytes as our inconsistency, not a bad id", async () => {
    const { asset } = await readyJobWithAsset();
    const row = await getAsset(asset.id, SESSION);
    await getStorage().delete(row!.storageKey);

    const response = await getAssetRoute(
      `http://test.local/api/assets/${asset.id}`,
      asset.id,
    );
    expect(response.status).toBe(502);
  });

  it("404s an unknown id", async () => {
    const response = await getAssetRoute(
      "http://test.local/api/assets/ast_nope",
      "ast_nope",
    );
    expect(response.status).toBe(404);
  });

  it("locks without a cookie, even if middleware were gone", async () => {
    // The defense-in-depth guard, exercised with the middleware nowhere in
    // sight — which is exactly the situation it exists for.
    const { asset } = await readyJobWithAsset();
    unlockCookie = "";
    try {
      const response = await getAssetRoute(
        `http://test.local/api/assets/${asset.id}`,
        asset.id,
      );
      expect(response.status).toBe(401);
    } finally {
      unlockCookie = await mintUnlockCookie();
    }
  });
});

describeDb("the cancel route", () => {
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
      keyResolver: { getKeyForSession: async () => KEY },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    at(0);
    // Minted under the faked clock: the cookie's age check would (correctly)
    // reject one issued from the real future.
    unlockCookie = await mintUnlockCookie();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPorts();
  });

  async function postCancel(id: string) {
    const { POST } = await import("@/app/api/jobs/[id]/cancel/route");
    return POST(new Request(`http://test.local/api/jobs/${id}/cancel`), {
      params: Promise.resolve({ id }),
    });
  }

  it("cancels a queued job", async () => {
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params: { prompt: "a lighthouse at dusk" },
    });

    const response = await postCancel(job.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("canceled");
  });

  it("absorbs a cancel during ingest instead of 500ing", async () => {
    // This exact call used to escape as an unshaped 500: the machine refuses
    // CANCELED from `ingesting` (correctly), and the route rethrew.
    const job = await submitJob({
      sessionId: SESSION,
      lookId: "quick-sketch",
      params: { prompt: "a lighthouse at dusk" },
    });
    await applyTransition(job.id, { type: "PROVIDER_RUNNING" }, "system");
    await applyTransition(job.id, { type: "PROVIDER_COMPLETED" }, "system");

    const response = await postCancel(job.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("ingesting");
  });

  it("404s an unknown job", async () => {
    const response = await postCancel("job_nope");
    expect(response.status).toBe(404);
  });
});
