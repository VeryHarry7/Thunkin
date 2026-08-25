import { z } from "zod";
import { JobKind } from "./job";

/**
 * How a model is described to the rest of the app.
 *
 * FROZEN CONTRACT — AGENT-02 fills the registry with these. The point of the
 * shape is the `look` field: the UI sells a visual direction, and the fal
 * endpoint id is an implementation detail surfaced only under Advanced.
 */

/** Speed-versus-quality band, used to group the picker. */
export const ModelTier = z.enum(["fast", "balanced", "max"]);
export type ModelTier = z.infer<typeof ModelTier>;

/**
 * What a model can actually do. The UI reads this to decide which controls to
 * render — a look that cannot take an image input must not show the control.
 */
export const ModelSupports = z.object({
  imageInput: z.boolean(),
  refImages: z.boolean(),
  audio: z.boolean(),
  duration: z.boolean(),
  seed: z.boolean(),
  negativePrompt: z.boolean(),
});
export type ModelSupports = z.infer<typeof ModelSupports>;

export const ModelDescriptor = z.object({
  /** Stable internal id, referenced by Job.lookId. Never a fal endpoint. */
  lookId: z.string(),
  /** The fal endpoint, e.g. "fal-ai/flux-2/pro". */
  endpoint: z.string(),

  /** What the visitor reads: "Cinematic Portrait", not the endpoint. */
  look: z.string(),
  /** One line under the look name in the picker. */
  blurb: z.string(),

  kind: JobKind,
  tier: ModelTier,
  supports: ModelSupports,

  /** Aspect ratios this model accepts. First is the default. */
  aspectRatios: z.array(z.string()).min(1),

  /** Drives the honest progress copy — not a promise, an expectation. */
  estSeconds: z.number().positive(),
  /** Shown so a visitor spending their own credit knows the rough cost. */
  estCostUsd: z.number().nonnegative(),

  /** Prompts written to look genuinely good with this specific model. */
  promptStarters: z.array(z.string()),
  /** Path to the committed sample the picker card displays. */
  sampleAssetKey: z.string(),
});
export type ModelDescriptor = z.infer<typeof ModelDescriptor>;
