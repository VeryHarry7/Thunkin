import { env } from "@/lib/env";
import { mockProvider } from "./mock";
import { falProvider } from "./fal";
import type { Provider } from "./types";

export * from "./types";
export { resetMockProvider } from "./mock";
export { createFalProvider, falProvider, toResultPayload } from "./fal";

/**
 * Resolves the active provider from the env contract.
 *
 * This is the only place either adapter is chosen. Everything above the
 * boundary calls `getProvider()` and never imports an adapter directly, so
 * `FAL_MODE` genuinely controls what happens rather than merely suggesting it.
 */
export function getProvider(): Provider {
  switch (env.FAL_MODE) {
    case "mock":
      return mockProvider;
    case "live":
      return falProvider;
  }
}
