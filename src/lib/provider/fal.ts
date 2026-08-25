import type {
  Provider,
  ProviderOutput,
  ResultPayload,
  StatusResult,
  SubmitInput,
  SubmitResult,
} from "./types";
import { ProviderError } from "./types";
import type { JobErrorCode } from "@/lib/contracts";

/**
 * The live fal adapter.
 *
 * Talks to the queue API at https://queue.fal.run. `fetch` is injected so the
 * whole adapter is unit-testable without a network or a key — which matters,
 * because this is the one module in the system we cannot exercise for free.
 */

const QUEUE_BASE = "https://queue.fal.run";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * HTTP status onto the closed error taxonomy.
 *
 * Every branch lands on a code that has exactly one recovery action in the UI.
 * Resist adding a catch-all here — an unmapped status becoming MODEL_ERROR
 * ("retry, or swap look") is a deliberate, safe default.
 */
function codeForStatus(status: number): JobErrorCode {
  if (status === 401 || status === 403) return "INVALID_KEY";
  if (status === 402) return "INSUFFICIENT_CREDIT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 422 || status === 400) return "CONTENT_REJECTED";
  return "MODEL_ERROR";
}

/** Retrying a 429 or a 5xx can succeed; a rejected key or prompt cannot. */
function retryableForStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Pulls a displayable message out of a fal error body.
 *
 * Never returns raw provider internals — the message reaches a visitor, and a
 * stack trace or an internal id in the UI is both confusing and a small leak.
 */
function messageFromBody(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim() !== "") return body.slice(0, 300);
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["detail", "message", "error"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value.slice(0, 300);
    }
  }
  return fallback;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createFalProvider(fetchImpl: FetchLike = fetch): Provider {
  async function call(
    url: string,
    apiKey: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: {
          Authorization: `Key ${apiKey}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch {
      // Transport failure: DNS, TLS, timeout. Distinct from an HTTP error and
      // always worth retrying.
      throw new ProviderError(
        "NETWORK",
        "Could not reach the generation service.",
        true,
      );
    }

    const body = await readBody(response);

    if (!response.ok) {
      const code = codeForStatus(response.status);
      throw new ProviderError(
        code,
        messageFromBody(body, `The generation service returned ${response.status}.`),
        retryableForStatus(response.status),
      );
    }

    return body;
  }

  return {
    name: "fal",

    async submit(input: SubmitInput): Promise<SubmitResult> {
      if (!input.apiKey) {
        throw new ProviderError("INVALID_KEY", "No API key was supplied.");
      }

      // Asking for a webhook we cannot receive costs ~31 failed retries per
      // job on fal's side and gains nothing. Omitting it is the honest signal.
      const url = input.webhookUrl
        ? `${QUEUE_BASE}/${input.endpoint}?fal_webhook=${encodeURIComponent(input.webhookUrl)}`
        : `${QUEUE_BASE}/${input.endpoint}`;

      const body = await call(url, input.apiKey, {
        method: "POST",
        body: JSON.stringify(toFalPayload(input)),
      });

      const requestId = (body as { request_id?: unknown })?.request_id;
      if (typeof requestId !== "string" || requestId === "") {
        // Without a request id we can neither poll nor correlate a webhook, so
        // the job would be unrecoverable. Fail loudly at submit instead.
        throw new ProviderError(
          "MODEL_ERROR",
          "The generation service accepted the request but returned no id.",
          true,
        );
      }

      return { requestId };
    },

    async status(endpoint, requestId, apiKey): Promise<StatusResult> {
      const body = (await call(
        `${QUEUE_BASE}/${endpoint}/requests/${requestId}/status`,
        apiKey,
      )) as { status?: string; queue_position?: number };

      switch (body?.status) {
        case "IN_QUEUE":
          return body.queue_position === undefined
            ? { status: "IN_QUEUE" }
            : { status: "IN_QUEUE", queuePosition: body.queue_position };
        case "IN_PROGRESS":
          return { status: "IN_PROGRESS" };
        case "COMPLETED":
          return { status: "COMPLETED" };
        default:
          return {
            status: "FAILED",
            errorCode: "MODEL_ERROR",
            errorMessage: "The generation service reported an unknown state.",
          };
      }
    },

    async result(endpoint, requestId, apiKey): Promise<ResultPayload> {
      const body = await call(
        `${QUEUE_BASE}/${endpoint}/requests/${requestId}`,
        apiKey,
      );
      return toResultPayload(body);
    },

    async cancel(endpoint, requestId, apiKey): Promise<void> {
      try {
        await call(`${QUEUE_BASE}/${endpoint}/requests/${requestId}/cancel`, apiKey, {
          method: "PUT",
        });
      } catch (error) {
        // A job that already finished cannot be cancelled, and that is not a
        // failure worth surfacing — the caller's intent (stop this) is met.
        if (error instanceof ProviderError && error.code === "CONTENT_REJECTED") return;
        throw error;
      }
    },

    async verifyKey(apiKey: string): Promise<boolean> {
      if (!/^[A-Za-z0-9-]{8,}:[A-Za-z0-9]{8,}$/.test(apiKey)) return false;
      try {
        // Any authenticated round-trip proves the key. A status lookup for a
        // nonexistent request is the cheapest one: it never queues work.
        await call(`${QUEUE_BASE}/fal-ai/flux/requests/verify-probe/status`, apiKey);
        return true;
      } catch (error) {
        if (error instanceof ProviderError) {
          // Reaching auth and being told "no such request" means the key worked.
          return error.code !== "INVALID_KEY";
        }
        return false;
      }
    },
  };
}

/** Normalized params to fal's field names. */
function toFalPayload(input: SubmitInput): Record<string, unknown> {
  const { params } = input;
  const payload: Record<string, unknown> = { prompt: params.prompt };

  if (params.negativePrompt !== undefined) {
    payload.negative_prompt = params.negativePrompt;
  }
  if (params.aspectRatio !== undefined) payload.aspect_ratio = params.aspectRatio;
  if (params.seed !== undefined) payload.seed = params.seed;
  if (params.durationSeconds !== undefined) payload.duration = params.durationSeconds;
  if (params.inputAssetId !== undefined) payload.image_url = params.inputAssetId;

  return payload;
}

/**
 * fal's result shape onto ours.
 *
 * Output lives under `images` or `video` depending on the model, so both are
 * accepted rather than assuming one.
 */
export function toResultPayload(body: unknown): ResultPayload {
  const record = (body ?? {}) as Record<string, unknown>;
  const outputs: ProviderOutput[] = [];

  const images = record.images;
  if (Array.isArray(images)) {
    for (const item of images) {
      const output = toOutput(item, "image/jpeg");
      if (output) outputs.push(output);
    }
  }

  const video = record.video;
  if (video) {
    const output = toOutput(video, "video/mp4");
    if (output) outputs.push(output);
  }

  if (outputs.length === 0) {
    throw new ProviderError(
      "MODEL_ERROR",
      "The generation finished but produced no output.",
      true,
    );
  }

  const seed = record.seed;
  return typeof seed === "number" ? { outputs, seed } : { outputs };
}

function toOutput(item: unknown, defaultMime: string): ProviderOutput | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  if (typeof record.url !== "string") return null;

  const output: ProviderOutput = {
    url: record.url,
    mime: typeof record.content_type === "string" ? record.content_type : defaultMime,
    width: typeof record.width === "number" ? record.width : 0,
    height: typeof record.height === "number" ? record.height : 0,
  };

  if (typeof record.duration === "number") {
    output.durationMs = Math.round(record.duration * 1000);
  }

  return output;
}

/** The default live adapter, using the platform `fetch`. */
export const falProvider: Provider = createFalProvider();
