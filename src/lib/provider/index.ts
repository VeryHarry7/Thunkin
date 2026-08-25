import { env } from "@/lib/env";
import { mockProvider } from "./mock";
import type { Provider } from "./types";

export * from "./types";
export { resetMockProvider } from "./mock";

/**
 * Resolves the active provider from the env contract.
 *
 * AGENT-04 adds the `fal` adapter and wires it into the switch below. Until
 * then `FAL_MODE=live` fails loudly at the call site rather than silently
 * falling back to the mock — a deploy that thinks it is live but is not would
 * be a much worse bug than a clear error.
 */
export function getProvider(): Provider {
  switch (env.FAL_MODE) {
    case "mock":
      return mockProvider;
    case "live":
      throw new Error(
        "FAL_MODE=live but the fal adapter is not implemented yet (AGENT-04). " +
          "Set FAL_MODE=mock to develop against fixtures.",
      );
  }
}
