/**
 * What the live smoke concluded, as a pure function.
 *
 * This lives apart from the script that runs it because the verdict has been
 * wrong twice — once blaming `registry.ts` for a billing lockout, once
 * announcing "every endpoint failed" when one of two had just succeeded. A
 * verdict that misdirects is worse than no verdict: it sends you editing
 * model ids that were never in question. Being a pure function, it can be
 * tested; being tested, it can stop being wrong.
 */

/**
 * Tells an account-level rejection apart from a wrong endpoint id.
 *
 * fal reports an exhausted balance as a 403 with an explanatory body, and a
 * bad key as a 401 — neither has anything to do with which model you asked
 * for.
 */
export function isAccountProblem(reason) {
  return /exhausted balance|top up|billing|user is locked|unauthor|forbidden|invalid.*(key|credential)/i.test(
    reason,
  );
}

/**
 * @param {object} input
 * @param {string[]} input.attempted  every endpoint the run tried
 * @param {Array<[string, string]>} input.failures  [endpoint, reason] pairs
 * @returns {{ lines: string[], ok: boolean }}
 */
export function verdict({ attempted, failures }) {
  const failed = new Set(failures.map(([endpoint]) => endpoint));
  const verified = attempted.filter((endpoint) => !failed.has(endpoint));
  const accountFailures = failures.filter(([, reason]) => isAccountProblem(reason));
  const endpointFailures = failures.filter(([, reason]) => !isAccountProblem(reason));

  if (failures.length === 0) {
    return {
      ok: true,
      lines: [`All ${attempted.length} endpoint(s) work. These registry ids are real:`],
    };
  }

  const lines = [];

  // Never bury a success: verifying an id is the entire point of this script,
  // and an id proven real stays proven whatever else went wrong.
  if (verified.length > 0) {
    lines.push(`Verified working (${verified.length}):`);
    for (const endpoint of verified) lines.push(`  ✓ ${endpoint}`);
    lines.push("");
  }

  if (accountFailures.length === attempted.length) {
    lines.push(
      "Everything failed the same way, which points at the account rather than",
      "the registry — the key reached fal and fal declined it:",
      "",
      `  ${accountFailures[0][1]}`,
      "",
      "Fix that (top up, or check FAL_KEY), then run this again. No model id was",
      "tested: nothing got far enough to try one.",
    );
    return { ok: false, lines };
  }

  if (accountFailures.length > 0) {
    lines.push(
      `Account-level failures (${accountFailures.length}), while other endpoints`,
      "succeeded — so this is not a wrong id and not an empty balance. Most",
      "likely a lock that had not finished lifting when the request went out:",
      "",
    );
    for (const [endpoint, reason] of accountFailures) {
      lines.push(`  ? ${endpoint} — ${reason}`);
    }
    lines.push("", "Run the smoke again; these usually pass on a second attempt.");
  }

  if (endpointFailures.length > 0) {
    if (accountFailures.length > 0) lines.push("");
    lines.push(
      `These ${endpointFailures.length} need checking in src/lib/models/registry.ts:`,
    );
    for (const [endpoint, reason] of endpointFailures) {
      lines.push(`  ✗ ${endpoint} — ${reason}`);
    }
  }

  return { ok: false, lines };
}
