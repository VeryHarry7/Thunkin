import type {
  Provider,
  ResultPayload,
  StatusResult,
  SubmitInput,
  SubmitResult,
} from "./types";
import { ProviderError } from "./types";
import type { JobErrorCode } from "@/lib/contracts";

/**
 * The mock provider.
 *
 * Every test and CI run uses this, so nothing spends money. It is not a stub
 * that returns instantly — it advances through the same IN_QUEUE →
 * IN_PROGRESS → COMPLETED sequence on a compressed but realistically shaped
 * delay curve, because the states the UI has to render are exactly the ones a
 * too-fast mock would hide.
 *
 * Failure paths are reachable on purpose. A prompt beginning with a directive
 * makes the mock fail in a specific way, so the error taxonomy can be
 * exercised end to end:
 *
 *   "!fail:INVALID_KEY  a lighthouse"   → fails with that code
 *   "!slow  a lighthouse"               → takes ~4x as long
 *   "!stall a lighthouse"               → never completes (exercises the sweeper's
 *                                          expiry ceiling and the stuck-job path)
 */

interface MockRequest {
  endpoint: string;
  kind: "image" | "video";
  createdAt: number;
  /** Milliseconds from creation to COMPLETED. */
  durationMs: number;
  seed: number;
  failWith?: JobErrorCode;
  stall: boolean;
}

/**
 * Survives Next.js dev module reloads, which would otherwise orphan in-flight
 * mock requests and make every poll a 404.
 */
const globalForMock = globalThis as unknown as {
  __thunkinMockRequests?: Map<string, MockRequest>;
};

const requests: Map<string, MockRequest> =
  globalForMock.__thunkinMockRequests ?? new Map();
globalForMock.__thunkinMockRequests = requests;

/** Compressed but proportional: video still visibly outlasts image. */
const BASE_DURATION_MS = { image: 2_500, video: 8_000 } as const;
const QUEUE_FRACTION = 0.35;

/**
 * Raster on purpose.
 *
 * The asset pipeline rasterizes, derives a thumbnail and computes a blur
 * placeholder. Handing it an SVG would mean that whole path never runs the way
 * it runs in production, and the pipeline's tests would be testing a fiction.
 */
const FIXTURES = {
  image: {
    url: "/fixtures/mock-image.png",
    mime: "image/png",
    width: 1024,
    height: 1024,
  },
  video: {
    url: "/fixtures/mock-video.png",
    mime: "image/png",
    width: 1280,
    height: 720,
    durationMs: 5_000,
  },
} as const;

const DIRECTIVE = /^!(fail:([A-Z_]+)|slow|stall)\s*/;

function readDirectives(prompt: string): {
  failWith?: JobErrorCode;
  slow: boolean;
  stall: boolean;
} {
  let rest = prompt;
  let failWith: JobErrorCode | undefined;
  let slow = false;
  let stall = false;

  // Directives may be stacked: "!slow !fail:TIMEOUT a lighthouse".
  for (let match = DIRECTIVE.exec(rest); match; match = DIRECTIVE.exec(rest)) {
    const [consumed, directive, code] = match;
    if (directive?.startsWith("fail:") && code) {
      failWith = code as JobErrorCode;
    } else if (directive === "slow") {
      slow = true;
    } else if (directive === "stall") {
      stall = true;
    }
    rest = rest.slice(consumed.length);
  }

  return failWith ? { failWith, slow, stall } : { slow, stall };
}

function requireRequest(requestId: string): MockRequest {
  const request = requests.get(requestId);
  if (!request) {
    throw new ProviderError("MODEL_ERROR", `Unknown request ${requestId}.`);
  }
  return request;
}

function elapsedFraction(request: MockRequest): number {
  if (request.stall) return 0;
  return (Date.now() - request.createdAt) / request.durationMs;
}

export const mockProvider: Provider = {
  name: "mock",

  async submit(input: SubmitInput): Promise<SubmitResult> {
    if (!input.apiKey) {
      throw new ProviderError("INVALID_KEY", "No API key was supplied.");
    }

    // Adapted payloads always carry `prompt`, but the type no longer promises
    // it — the mock narrows like the trust boundary it stands in for.
    const prompt = typeof input.params.prompt === "string" ? input.params.prompt : "";
    const { failWith, slow, stall } = readDirectives(prompt);
    const base = BASE_DURATION_MS[input.kind];

    const requestId = `mock_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    requests.set(requestId, {
      endpoint: input.endpoint,
      kind: input.kind,
      createdAt: Date.now(),
      durationMs: slow ? base * 4 : base,
      seed:
        typeof input.params.seed === "number"
          ? input.params.seed
          : Math.floor(Math.random() * 2_147_483_647),
      stall,
      ...(failWith ? { failWith } : {}),
    });

    return { requestId };
  },

  async status(_endpoint, requestId): Promise<StatusResult> {
    const request = requireRequest(requestId);
    const progress = elapsedFraction(request);

    if (request.failWith && progress >= QUEUE_FRACTION) {
      return {
        status: "FAILED",
        errorCode: request.failWith,
        errorMessage: `Mock failure: ${request.failWith}.`,
      };
    }

    if (progress < QUEUE_FRACTION) {
      // Counts down as the request advances, the way a real queue reads.
      const position = Math.max(1, Math.ceil((QUEUE_FRACTION - progress) * 10));
      return { status: "IN_QUEUE", queuePosition: position };
    }

    if (progress < 1) return { status: "IN_PROGRESS" };

    return { status: "COMPLETED" };
  },

  async result(_endpoint, requestId): Promise<ResultPayload> {
    const request = requireRequest(requestId);

    if (request.failWith) {
      throw new ProviderError(request.failWith, `Mock failure: ${request.failWith}.`);
    }
    if (elapsedFraction(request) < 1) {
      throw new ProviderError("MODEL_ERROR", "Result requested before completion.");
    }

    const fixture = FIXTURES[request.kind];
    return {
      outputs: [{ ...fixture }],
      seed: request.seed,
    };
  },

  async cancel(_endpoint, requestId): Promise<void> {
    requests.delete(requestId);
  },
};

/** Clears in-flight mock state. Tests call this between cases. */
export function resetMockProvider(): void {
  requests.clear();
}
