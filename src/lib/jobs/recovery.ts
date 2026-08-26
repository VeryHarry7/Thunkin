import type { JobErrorCode } from "@/lib/contracts";

/**
 * Copy for every failure the taxonomy can produce, and its one way out.
 *
 * Typed against the closed `JobErrorCode` union on purpose: add a code to the
 * taxonomy and this file refuses to compile until the failure has recovery
 * copy — which is the "never a dead end" rule made mechanical.
 */

export interface Recovery {
  title: string;
  body: string;
  action: string;
}

export const RECOVERY: Record<JobErrorCode, Recovery> = {
  INVALID_KEY: {
    title: "fal refused the API key",
    body: "The key this server runs on was rejected. Check FAL_KEY in the environment and restart.",
    action: "Run it again",
  },
  INSUFFICIENT_CREDIT: {
    title: "Out of credit",
    body: "The fal account behind this server ran out of credit. Top it up and run this again.",
    action: "Run it again",
  },
  RATE_LIMITED: {
    title: "Too many at once",
    body: "The model is rate-limiting us. Waiting a few seconds is usually enough.",
    action: "Run it again",
  },
  CONTENT_REJECTED: {
    title: "The model declined this prompt",
    body: "Try describing the same idea differently — often a single word is the sticking point.",
    action: "Edit the prompt",
  },
  MODEL_ERROR: {
    title: "The model failed",
    body: "Nothing was charged for this. Running it again usually works; a different look always does.",
    action: "Run it again",
  },
  TIMEOUT: {
    title: "This took too long",
    body: "We stopped waiting after the ceiling for this kind of generation.",
    action: "Run it again",
  },
  NETWORK: {
    title: "Couldn't reach the model",
    body: "A connection problem on the way out. Your prompt is still here.",
    action: "Run it again",
  },
  INGEST_FAILED: {
    title: "The result got away",
    body: "The model finished, but we couldn't save the file before its link expired.",
    action: "Run it again",
  },
};
