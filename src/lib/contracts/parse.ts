import { type z } from "zod";

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
