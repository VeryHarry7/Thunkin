import { type z } from "zod";

/** Thrown by `parseOrThrow`. Carries the issues so callers can map to fields. */
export class ContractViolation extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(label: string, issues: z.core.$ZodIssue[]) {
    const detail = issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    super(`${label} failed validation — ${detail}`);
    this.name = "ContractViolation";
    this.issues = issues;
  }
}

/**
 * Parse against a contract, throwing a labelled error on failure.
 *
 * Use this at trust boundaries — request bodies, provider responses, webhook
 * payloads — so a malformed value is caught where it enters rather than three
 * layers deeper as an undefined property.
 */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  label = "value",
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ContractViolation(label, result.error.issues);
  }
  return result.data;
}

/** Collapses issues into a field-keyed map for `ApiError.fields`. */
export function issuesToFields(issues: z.core.$ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_";
    // First issue per field wins — showing one clear message beats stacking them.
    fields[key] ??= issue.message;
  }
  return fields;
}
