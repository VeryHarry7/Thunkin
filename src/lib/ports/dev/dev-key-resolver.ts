import type { KeyResolver } from "../types";
import { env } from "@/lib/env";

/**
 * A development stand-in for AGENT-03's vault-backed resolver.
 *
 * It hands every session the same key from `DEV_FAL_KEY`, which is only ever
 * acceptable while nothing real is at stake.
 *
 * The guard is on `FAL_MODE`, not `NODE_ENV`, because that is where the actual
 * risk lives: the danger of a shared configured key is that every visitor bills
 * one fal account instead of their own, and that can only happen when the live
 * adapter is in play. Under `FAL_MODE=mock` the key is a meaningless string and
 * no request leaves the process, so a production-mode build (which is exactly
 * what the e2e suite runs) is free to use it.
 *
 * Keying off `NODE_ENV` instead would be both weaker and stricter in the wrong
 * places: it would happily allow a developer to point a shared key at live fal
 * locally, while blocking a build that cannot spend anything.
 *
 * AGENT-03 replaces this with a resolver that decrypts the visitor's own key
 * from their session row, at which point this file should be deleted.
 */
export const devKeyResolver: KeyResolver = {
  async getKeyForSession(_sessionId: string): Promise<string | null> {
    if (env.FAL_MODE === "live") {
      throw new Error(
        "The development key resolver cannot be used with FAL_MODE=live — " +
          "every visitor would generate on the same fal account. Wire in " +
          "AGENT-03's vault-backed resolver first.",
      );
    }
    return env.DEV_FAL_KEY ?? null;
  },
};
