import { z } from "zod";
import { JobErrorCode } from "./job";

/**
 * The shape of every API response.
 *
 * FROZEN CONTRACT — a route handler returns `ApiResult<T>` and nothing else.
 * A caller can therefore always branch on `ok` without knowing the route.
 */

/**
 * Failures the API can report.
 *
 * The generation-specific codes are reused from `JobErrorCode` so a failure
 * means the same thing whether it surfaces on submit or arrives later on the
 * job record. The rest are transport-level.
 */
export const ApiErrorCode = z.union([
  JobErrorCode,
  z.enum([
    /** Request body failed schema validation. */
    "BAD_REQUEST",
    /** No session cookie, or no verified key on the session. */
    "NO_KEY",
    /** Resource does not exist, or belongs to another session. */
    "NOT_FOUND",
    /** Caller tripped our own rate limit (distinct from the provider's). */
    "TOO_MANY_REQUESTS",
    /** Unexpected server-side failure. */
    "INTERNAL",
  ]),
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  code: ApiErrorCode,
  /** Safe to display. Written for a visitor, not for a log. */
  message: z.string(),
  /** Field-level detail when `code` is BAD_REQUEST. */
  fields: z.record(z.string(), z.string()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** Builds the success arm. */
export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

/** Builds the failure arm. */
export function err<T = never>(
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string>,
): ApiResult<T> {
  return { ok: false, error: fields ? { code, message, fields } : { code, message } };
}

/** Wraps a payload schema in the success arm, for validating responses. */
export function apiResultSchema<T extends z.ZodTypeAny>(payload: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data: payload }),
    z.object({ ok: z.literal(false), error: ApiError }),
  ]);
}
