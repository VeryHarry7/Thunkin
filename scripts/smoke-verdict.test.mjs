import { describe, expect, it } from "vitest";
import { isAccountProblem, verdict } from "./smoke-verdict.mjs";

/**
 * The verdict has been wrong twice against real fal output. Both real cases
 * are pinned here.
 */

const BALANCE =
  'HTTP 403: {"detail":"User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing."}';
const BAD_KEY = 'HTTP 401: {"detail":"invalid key credentials"}';
const WRONG_ID = 'HTTP 404: {"detail":"Not Found"}';

const FLUX = "fal-ai/flux/schnell";
const NANO = "fal-ai/nano-banana-pro";

const text = (result) => result.lines.join("\n");

describe("isAccountProblem", () => {
  it("recognises the account-level rejections fal actually sends", () => {
    expect(isAccountProblem(BALANCE)).toBe(true);
    expect(isAccountProblem(BAD_KEY)).toBe(true);
  });

  it("does not claim a missing endpoint is an account problem", () => {
    expect(isAccountProblem(WRONG_ID)).toBe(false);
    expect(isAccountProblem("completed but no output url")).toBe(false);
  });
});

describe("verdict", () => {
  it("reports success when everything works", () => {
    const result = verdict({ attempted: [FLUX, NANO], failures: [] });
    expect(result.ok).toBe(true);
  });

  it("blames the account only when nothing at all got through", () => {
    const result = verdict({
      attempted: [FLUX, NANO],
      failures: [
        [FLUX, BALANCE],
        [NANO, BALANCE],
      ],
    });
    expect(result.ok).toBe(false);
    expect(text(result)).toContain("points at the account");
    expect(text(result)).toContain("No model id was");
    // The bug this replaces: never send someone to registry.ts for billing.
    expect(text(result)).not.toContain("registry.ts");
  });

  it("does not say everything failed when something succeeded", () => {
    // The real second run: flux hit a stale lock, nano-banana-pro produced an
    // image 19 seconds later. Claiming "every endpoint failed" was false, and
    // claiming the ids were "still unverified" erased a real verification.
    const result = verdict({
      attempted: [FLUX, NANO],
      failures: [[FLUX, BALANCE]],
    });

    const output = text(result);
    expect(output).not.toContain("Everything failed");
    expect(output).not.toContain("No model id was");
    expect(output).toContain("Verified working");
    expect(output).toContain(NANO);
    expect(output).toContain("Run the smoke again");
    expect(result.ok).toBe(false);
  });

  it("sends only genuine endpoint failures to the registry", () => {
    const result = verdict({
      attempted: [FLUX, NANO],
      failures: [[FLUX, WRONG_ID]],
    });

    const output = text(result);
    expect(output).toContain("registry.ts");
    expect(output).toContain(FLUX);
    // The one that worked is still reported as working.
    expect(output).toContain("Verified working");
    expect(output).toContain(NANO);
  });

  it("separates the two kinds when both happen at once", () => {
    const result = verdict({
      attempted: [FLUX, NANO, "fal-ai/veo3.1/fast"],
      failures: [
        [FLUX, BALANCE],
        [NANO, WRONG_ID],
      ],
    });

    const output = text(result);
    expect(output).toContain("Run the smoke again"); // for the locked one
    expect(output).toContain("registry.ts"); // for the wrong id
    expect(output).toContain("Verified working"); // for veo
  });
});
