import type { KeyResolver } from "@/lib/ports";
import { env } from "@/lib/env";

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
export const serverKeyResolver: KeyResolver = {
  async getKey(): Promise<string | null> {
    // The env contract already refuses to boot with FAL_MODE=live and no key,
    // so a null here can only mean mock mode, where it is harmless.
    return env.FAL_KEY ?? null;
  },
};
