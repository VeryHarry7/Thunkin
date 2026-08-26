import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mockProvider, resetMockProvider } from "./mock";
import { ProviderError } from "./types";

const KEY = "abc12345:def67890";

function submit(prompt: string, kind: "image" | "video" = "image") {
  return mockProvider.submit({
    endpoint: "mock/test",
    kind,
    params: { prompt },
    apiKey: KEY,
    webhookUrl: "http://localhost:3000/api/webhooks/fal",
  });
}

beforeEach(() => {
  resetMockProvider();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mock provider lifecycle", () => {
  it("advances through queue, progress, then completion", async () => {
    const { requestId } = await submit("a lighthouse at dusk");

    // Images take ~2.5s in the mock; the first 35% of that reads as queued.
    expect((await mockProvider.status("mock/test", requestId, KEY)).status).toBe(
      "IN_QUEUE",
    );

    vi.advanceTimersByTime(1_500);
    expect((await mockProvider.status("mock/test", requestId, KEY)).status).toBe(
      "IN_PROGRESS",
    );

    vi.advanceTimersByTime(1_500);
    expect((await mockProvider.status("mock/test", requestId, KEY)).status).toBe(
      "COMPLETED",
    );
  });

  it("reports a queue position that counts down", async () => {
    const { requestId } = await submit("a lighthouse");

    const first = await mockProvider.status("mock/test", requestId, KEY);
    vi.advanceTimersByTime(500);
    const second = await mockProvider.status("mock/test", requestId, KEY);

    expect(first.queuePosition).toBeGreaterThan(0);
    expect(second.queuePosition!).toBeLessThanOrEqual(first.queuePosition!);
  });

  it("makes video visibly outlast image", async () => {
    const image = await submit("x", "image");
    const video = await submit("x", "video");

    vi.advanceTimersByTime(3_000);

    expect((await mockProvider.status("mock/test", image.requestId, KEY)).status).toBe(
      "COMPLETED",
    );
    expect((await mockProvider.status("mock/test", video.requestId, KEY)).status).toBe(
      "IN_PROGRESS",
    );
  });

  it("returns a fixture output and the seed actually used", async () => {
    const { requestId } = await submit("a lighthouse");
    vi.advanceTimersByTime(3_000);

    const result = await mockProvider.result("mock/test", requestId, KEY);

    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]!.url).toBe("/fixtures/mock-image.png");
    expect(result.seed).toBeTypeOf("number");
  });

  it("honours a caller-supplied seed so results are reproducible", async () => {
    const { requestId } = await mockProvider.submit({
      endpoint: "mock/test",
      kind: "image",
      params: { prompt: "a lighthouse", seed: 4242 },
      apiKey: KEY,
      webhookUrl: "http://localhost:3000/api/webhooks/fal",
    });
    vi.advanceTimersByTime(3_000);

    expect((await mockProvider.result("mock/test", requestId, KEY)).seed).toBe(4242);
  });

  it("refuses to hand back a result before completion", async () => {
    const { requestId } = await submit("a lighthouse");
    await expect(mockProvider.result("mock/test", requestId, KEY)).rejects.toThrow(
      ProviderError,
    );
  });
});

describe("mock provider test directives", () => {
  it("fails with the requested taxonomy code", async () => {
    const { requestId } = await submit("!fail:CONTENT_REJECTED a lighthouse");
    vi.advanceTimersByTime(1_500);

    const status = await mockProvider.status("mock/test", requestId, KEY);
    expect(status.status).toBe("FAILED");
    expect(status.errorCode).toBe("CONTENT_REJECTED");
  });

  it("stretches the delay curve under !slow", async () => {
    const { requestId } = await submit("!slow a lighthouse");
    vi.advanceTimersByTime(3_000);

    expect((await mockProvider.status("mock/test", requestId, KEY)).status).not.toBe(
      "COMPLETED",
    );
  });

  it("never completes under !stall, so the sweeper's ceiling is testable", async () => {
    const { requestId } = await submit("!stall a lighthouse");
    vi.advanceTimersByTime(600_000);

    expect((await mockProvider.status("mock/test", requestId, KEY)).status).toBe(
      "IN_QUEUE",
    );
  });

  it("accepts stacked directives", async () => {
    const { requestId } = await submit("!slow !fail:TIMEOUT a lighthouse");
    vi.advanceTimersByTime(6_000);

    const status = await mockProvider.status("mock/test", requestId, KEY);
    expect(status.status).toBe("FAILED");
    expect(status.errorCode).toBe("TIMEOUT");
  });
});

describe("mock provider key handling", () => {
  it("rejects a submit with no key", async () => {
    await expect(
      mockProvider.submit({
        endpoint: "mock/test",
        kind: "image",
        params: { prompt: "x" },
        apiKey: "",
        webhookUrl: "http://localhost:3000/api/webhooks/fal",
      }),
    ).rejects.toThrow(ProviderError);
  });
});

describe("mock provider cancellation", () => {
  it("forgets a cancelled request", async () => {
    const { requestId } = await submit("a lighthouse");
    await mockProvider.cancel("mock/test", requestId, KEY);

    await expect(mockProvider.status("mock/test", requestId, KEY)).rejects.toThrow(
      ProviderError,
    );
  });
});
