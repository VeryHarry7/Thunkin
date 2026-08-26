import type { KeyResolver } from "@/lib/ports";
import { env, isMockProvider } from "@/lib/env";

/**
 * The key resolver for a single-user service.
 *
 * One key, held server-side, used for every generation and never sent to a
 * browser. This is the whole of key management now — the bring-your-own-key
 * vault that earlier plans specced (encryption at rest, per-session custody,
 * fingerprints, entry rate limiting) exists to protect *other people's*
 * secrets, and there are no other people.
 *
 * The `KeyResolver` port stays in place because it costs nothing and is the
 * seam if this ever becomes multi-user again.
 */
/**
 * Stands in for a key under `FAL_MODE=mock`.
 *
 * The mock provider ignores whatever key it is handed, but `submitJob`
 * refuses to submit without one — so returning null here would break the
 * keyless quickstart the README documents ("costs nothing, needs no key")
 * with a 401 on every generation. It never leaves the process: the mock
 * adapter makes no network call at all.
 */
const MOCK_KEY = "mock:no-key-required";

export const serverKeyResolver: KeyResolver = {
  async getKey(): Promise<string | null> {
    if (isMockProvider) return MOCK_KEY;

    // Live mode: the env contract already refuses to boot without a key, so
    // a null here means someone bypassed it — fail rather than guess.
    return env.FAL_KEY ?? null;
  },
};
