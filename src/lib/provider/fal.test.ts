import { describe, it, expect } from "vitest";
import { createFalProvider, toResultPayload } from "./fal";
import { ProviderError } from "./types";
import type { FetchLike } from "./fal";
import type { SubmitInput } from "./types";

const KEY = "abc12345:def67890";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(response: Response | (() => Promise<Response>)) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return typeof response === "function" ? response() : response;
  };
  return { impl, calls };
}

const SUBMIT: SubmitInput = {
  endpoint: "fal-ai/flux-2/pro",
  kind: "image",
  params: { prompt: "a lighthouse at dusk" },
  apiKey: KEY,
  webhookUrl: "https://thunkin.example/api/webhooks/fal",
};

describe("submit", () => {
  it("posts to the queue endpoint with the webhook attached", async () => {
    const { impl, calls } = stubFetch(jsonResponse({ request_id: "req_1" }));
    const provider = createFalProvider(impl);

    const result = await provider.submit(SUBMIT);

    expect(result.requestId).toBe("req_1");
    expect(calls[0]!.url).toBe(
      "https://queue.fal.run/fal-ai/flux-2/pro" +
        "?fal_webhook=https%3A%2F%2Fthunkin.example%2Fapi%2Fwebhooks%2Ffal",
    );
    expect(calls[0]!.init?.method).toBe("POST");
  });

  it("omits fal_webhook entirely when nothing can reach us", async () => {
    // A LAN deployment. Asking for a callback that can never arrive costs ~31
    // failed retries per job on fal's side and gains nothing here.
    const { impl, calls } = stubFetch(jsonResponse({ request_id: "req_1" }));

    await createFalProvider(impl).submit({ ...SUBMIT, webhookUrl: null });

    expect(calls[0]!.url).toBe("https://queue.fal.run/fal-ai/flux-2/pro");
    expect(calls[0]!.url).not.toContain("fal_webhook");
  });

  it("sends the key as an Authorization header, never in the URL", async () => {
    const { impl, calls } = stubFetch(jsonResponse({ request_id: "req_1" }));
    await createFalProvider(impl).submit(SUBMIT);

    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Key ${KEY}`);
    expect(calls[0]!.url).not.toContain(KEY);
  });

  it("translates normalized params into fal's field names", async () => {
    const { impl, calls } = stubFetch(jsonResponse({ request_id: "req_1" }));

    await createFalProvider(impl).submit({
      ...SUBMIT,
      params: {
        prompt: "a lighthouse",
        negativePrompt: "blurry",
        aspectRatio: "16:9",
        seed: 7,
        durationSeconds: 5,
      },
    });

    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      prompt: "a lighthouse",
      negative_prompt: "blurry",
      aspect_ratio: "16:9",
      seed: 7,
      duration: 5,
    });
  });

  it("omits absent optional params rather than sending nulls", async () => {
    const { impl, calls } = stubFetch(jsonResponse({ request_id: "req_1" }));
    await createFalProvider(impl).submit(SUBMIT);

    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      prompt: "a lighthouse at dusk",
    });
  });

  it("fails loudly when the service returns no request id", async () => {
    // Without an id we can neither poll nor match a webhook, so the job would
    // be unrecoverable. Better to fail at submit.
    const { impl } = stubFetch(jsonResponse({ status: "OK" }));
    await expect(createFalProvider(impl).submit(SUBMIT)).rejects.toThrow(ProviderError);
  });

  it("rejects an empty key without making a request", async () => {
    const { impl, calls } = stubFetch(jsonResponse({ request_id: "x" }));
    await expect(
      createFalProvider(impl).submit({ ...SUBMIT, apiKey: "" }),
    ).rejects.toThrow(ProviderError);
    expect(calls).toHaveLength(0);
  });
});

describe("error taxonomy", () => {
  const cases: Array<[number, string, boolean]> = [
    [401, "INVALID_KEY", false],
    [403, "INVALID_KEY", false],
    [402, "INSUFFICIENT_CREDIT", false],
    [429, "RATE_LIMITED", true],
    [422, "CONTENT_REJECTED", false],
    [400, "CONTENT_REJECTED", false],
    [500, "MODEL_ERROR", true],
    [503, "MODEL_ERROR", true],
  ];

  for (const [status, code, retryable] of cases) {
    it(`maps HTTP ${status} to ${code} (retryable: ${retryable})`, async () => {
      const { impl } = stubFetch(jsonResponse({ detail: "nope" }, status));

      await expect(createFalProvider(impl).submit(SUBMIT)).rejects.toMatchObject({
        code,
        retryable,
      });
    });
  }

  it("maps a transport failure to NETWORK and marks it retryable", async () => {
    const impl: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(createFalProvider(impl).submit(SUBMIT)).rejects.toMatchObject({
      code: "NETWORK",
      retryable: true,
    });
  });

  it("surfaces the service's message when it gives one", async () => {
    const { impl } = stubFetch(
      jsonResponse({ detail: "Prompt violates content policy." }, 422),
    );

    await expect(createFalProvider(impl).submit(SUBMIT)).rejects.toThrow(
      /content policy/i,
    );
  });

  it("falls back to a readable message when the body is unhelpful", async () => {
    const { impl } = stubFetch(new Response("", { status: 500 }));

    await expect(createFalProvider(impl).submit(SUBMIT)).rejects.toThrow(/500/);
  });
});

describe("status", () => {
  it("reports queue position when the service gives one", async () => {
    const { impl } = stubFetch(jsonResponse({ status: "IN_QUEUE", queue_position: 4 }));

    expect(await createFalProvider(impl).status("e", "r", KEY)).toEqual({
      status: "IN_QUEUE",
      queuePosition: 4,
    });
  });

  it("omits queue position rather than inventing zero", async () => {
    const { impl } = stubFetch(jsonResponse({ status: "IN_QUEUE" }));
    expect(await createFalProvider(impl).status("e", "r", KEY)).toEqual({
      status: "IN_QUEUE",
    });
  });

  it("maps in-progress and completed", async () => {
    const running = stubFetch(jsonResponse({ status: "IN_PROGRESS" }));
    expect((await createFalProvider(running.impl).status("e", "r", KEY)).status).toBe(
      "IN_PROGRESS",
    );

    const done = stubFetch(jsonResponse({ status: "COMPLETED" }));
    expect((await createFalProvider(done.impl).status("e", "r", KEY)).status).toBe(
      "COMPLETED",
    );
  });

  it("treats an unrecognized state as a failure rather than guessing", async () => {
    const { impl } = stubFetch(jsonResponse({ status: "WHAT" }));
    const result = await createFalProvider(impl).status("e", "r", KEY);

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("MODEL_ERROR");
  });
});

describe("cancel", () => {
  it("issues a PUT to the cancel endpoint", async () => {
    const { impl, calls } = stubFetch(jsonResponse({}));
    await createFalProvider(impl).cancel("e", "r", KEY);

    expect(calls[0]!.url).toBe("https://queue.fal.run/e/requests/r/cancel");
    expect(calls[0]!.init?.method).toBe("PUT");
  });

  it("treats an already-finished job as cancelled, not an error", async () => {
    // The caller's intent — stop this — is satisfied either way.
    const { impl } = stubFetch(jsonResponse({ detail: "already completed" }, 400));
    await expect(
      createFalProvider(impl).cancel("e", "r", KEY),
    ).resolves.toBeUndefined();
  });

  it("still propagates a genuine failure", async () => {
    const { impl } = stubFetch(jsonResponse({ detail: "nope" }, 500));
    await expect(createFalProvider(impl).cancel("e", "r", KEY)).rejects.toThrow(
      ProviderError,
    );
  });
});

describe("verifyKey", () => {
  it("rejects a malformed key without a network call", async () => {
    const { impl, calls } = stubFetch(jsonResponse({}));
    expect(await createFalProvider(impl).verifyKey("not-a-key")).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("accepts a key that reaches the service", async () => {
    const { impl } = stubFetch(jsonResponse({ status: "COMPLETED" }));
    expect(await createFalProvider(impl).verifyKey(KEY)).toBe(true);
  });

  it("accepts a key even when the probe request is not found", async () => {
    // Reaching auth and being told "no such request" proves the key works.
    const { impl } = stubFetch(jsonResponse({ detail: "not found" }, 404));
    expect(await createFalProvider(impl).verifyKey(KEY)).toBe(true);
  });

  it("rejects a key the service refuses", async () => {
    const { impl } = stubFetch(jsonResponse({ detail: "unauthorized" }, 401));
    expect(await createFalProvider(impl).verifyKey(KEY)).toBe(false);
  });
});

describe("toResultPayload", () => {
  it("reads an image result", () => {
    const payload = toResultPayload({
      images: [{ url: "https://x/1.jpg", width: 1024, height: 1024 }],
      seed: 42,
    });

    expect(payload.outputs).toHaveLength(1);
    expect(payload.outputs[0]).toMatchObject({ url: "https://x/1.jpg", width: 1024 });
    expect(payload.seed).toBe(42);
  });

  it("reads a video result and converts duration to milliseconds", () => {
    const payload = toResultPayload({
      video: { url: "https://x/1.mp4", width: 1280, height: 720, duration: 5 },
    });

    expect(payload.outputs[0]).toMatchObject({
      url: "https://x/1.mp4",
      durationMs: 5000,
    });
  });

  it("honours an explicit content type over the default", () => {
    const payload = toResultPayload({
      images: [{ url: "https://x/1.png", content_type: "image/png" }],
    });
    expect(payload.outputs[0]!.mime).toBe("image/png");
  });

  it("throws when a finished generation produced nothing", () => {
    // Silently returning zero outputs would strand the job in ingesting.
    expect(() => toResultPayload({ seed: 1 })).toThrow(ProviderError);
  });

  it("skips malformed entries rather than emitting a broken output", () => {
    const payload = toResultPayload({
      images: [{ nope: true }, { url: "https://x/ok.jpg" }],
    });
    expect(payload.outputs).toHaveLength(1);
  });
});
