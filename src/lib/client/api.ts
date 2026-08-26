import { z } from "zod";
import {
  ApiJob,
  ApiJobWithAssets,
  apiResultSchema,
  type ApiErrorCode,
  type ApiResult,
  type GenerationParams,
} from "@/lib/contracts";

/**
 * The one place the client talks to the server.
 *
 * Every response is parsed against the wire schema before anything touches
 * it — the components used to cast `await response.json()` and hope, which is
 * how the Date-typed-but-string-valued contract survived unnoticed for so
 * long. A malformed body is an error here, not an undefined three layers up.
 */

export class ApiCallError extends Error {
  readonly code: ApiErrorCode | "INTERNAL";
  readonly fields?: Record<string, string>;

  constructor(
    code: ApiErrorCode | "INTERNAL",
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiCallError";
    this.code = code;
    if (fields) this.fields = fields;
  }
}

async function call<Schema extends z.ZodTypeAny>(
  payload: Schema,
  input: string,
  init?: RequestInit,
): Promise<z.infer<Schema>> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new ApiCallError("NETWORK", "Couldn't reach the server.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  const parsed = apiResultSchema(payload).safeParse(body);
  if (!parsed.success) {
    throw new ApiCallError(
      "INTERNAL",
      "The server answered in a shape this client doesn't recognise.",
    );
  }

  // The schema parsed exactly this shape; TypeScript just cannot carry a
  // discriminated union through the generic, so the annotation restores it.
  const result = parsed.data as ApiResult<z.infer<Schema>>;
  if (!result.ok) {
    const { code, message, fields } = result.error;
    throw new ApiCallError(code, message, fields);
  }
  return result.data;
}

export async function getJobs(options: { limit?: number } = {}) {
  const limit = options.limit ?? 40;
  return call(z.array(ApiJobWithAssets), `/api/jobs?limit=${limit}`);
}

export async function submitJob(body: {
  lookId: string;
  params: GenerationParams;
  idempotencyKey: string;
}) {
  return call(ApiJobWithAssets, "/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function cancelJob(id: string) {
  // Cancel returns the bare job — no assets ride along on this route.
  return call(ApiJob, `/api/jobs/${id}/cancel`, { method: "POST" });
}

export async function deleteJob(id: string): Promise<void> {
  await call(z.object({ deleted: z.boolean() }), `/api/jobs/${id}`, {
    method: "DELETE",
  });
}
