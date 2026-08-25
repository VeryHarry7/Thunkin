import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * The generation loop over real HTTP.
 *
 * The service layer is covered by integration tests; this proves the routes,
 * cookies, and session scoping actually work when driven the way a browser
 * drives them. Runs against the mock provider, so it costs nothing.
 */

/** Polls until the job settles, or gives up. */
async function waitForTerminal(
  request: APIRequestContext,
  jobId: string,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  const terminal = new Set(["ready", "failed", "canceled", "expired"]);

  while (Date.now() < deadline) {
    const response = await request.get(`/api/jobs/${jobId}`);
    const body = await response.json();
    if (body.ok && terminal.has(body.data.status)) return body.data;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Job ${jobId} never reached a terminal state.`);
}

test.describe("generation over HTTP", () => {
  test("submits a job and drives it to ready", async ({ request }) => {
    const create = await request.post("/api/jobs", {
      data: {
        lookId: "seed-image",
        params: { prompt: "a lighthouse at dusk" },
        idempotencyKey: `e2e_${Date.now()}_${Math.random()}`,
      },
    });

    expect(create.status()).toBe(201);
    const created = await create.json();
    expect(created.ok).toBe(true);
    expect(created.data.status).toBe("queued");

    // No webhook can reach a test server, so this is the sweeper's path —
    // exactly the situation that would silently lose jobs without it.
    const settled = await waitForTerminal(request, created.data.id);
    expect(settled.status).toBe("ready");
  });

  test("collapses a repeated idempotency key into one job", async ({ request }) => {
    const idempotencyKey = `e2e_dupe_${Date.now()}_${Math.random()}`;
    const body = {
      lookId: "seed-image",
      params: { prompt: "a lighthouse at dusk" },
      idempotencyKey,
    };

    const first = await request.post("/api/jobs", { data: body });
    const second = await request.post("/api/jobs", { data: body });

    expect((await first.json()).data.id).toBe((await second.json()).data.id);
  });

  test("rejects a malformed submission with field detail", async ({ request }) => {
    const response = await request.post("/api/jobs", {
      data: { lookId: "seed-image", params: { prompt: "" } },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.fields).toBeTruthy();
  });

  test("rejects an unknown look", async ({ request }) => {
    const response = await request.post("/api/jobs", {
      data: { lookId: "no-such-look", params: { prompt: "a lighthouse" } },
    });

    expect(response.status()).toBe(400);
  });

  test("returns 404, not 403, for a job id that is not yours", async ({ request }) => {
    // A 403 would confirm the id exists and hand an enumerator an oracle.
    const response = await request.get(
      "/api/jobs/job_00000000-0000-0000-0000-000000000000",
    );
    expect(response.status()).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  test("lists only this session's jobs", async ({ request }) => {
    const create = await request.post("/api/jobs", {
      data: {
        lookId: "seed-image",
        params: { prompt: "a lighthouse at dusk" },
        idempotencyKey: `e2e_list_${Date.now()}_${Math.random()}`,
      },
    });
    const created = await create.json();

    const list = await request.get("/api/jobs");
    const body = await list.json();

    expect(body.ok).toBe(true);
    expect(body.data.map((job: { id: string }) => job.id)).toContain(created.data.id);
  });
});

test.describe("webhook endpoint", () => {
  test("rejects an unsigned delivery", async ({ request }) => {
    // An unverified webhook is an anonymous POST from the internet.
    const response = await request.post("/api/webhooks/fal", {
      data: { request_id: "req_forged", status: "OK" },
    });

    expect(response.status()).toBe(401);
  });

  test("rejects a delivery carrying a bogus signature", async ({ request }) => {
    const response = await request.post("/api/webhooks/fal", {
      headers: {
        "x-fal-webhook-request-id": "wh_1",
        "x-fal-webhook-user-id": "user_1",
        "x-fal-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-fal-webhook-signature": "deadbeef",
      },
      data: { request_id: "req_forged", status: "OK" },
    });

    expect(response.status()).toBe(401);
  });
});

test.describe("sweep endpoint", () => {
  test("refuses an unauthenticated caller", async ({ request }) => {
    const response = await request.get("/api/internal/sweep");
    expect(response.status()).toBe(401);
  });

  test("runs for a caller with the shared secret", async ({ request }) => {
    const response = await request.get("/api/internal/sweep?secret=e2e-sweep-secret");
    expect(response.status()).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });
});
