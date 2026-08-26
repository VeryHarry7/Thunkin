import type { GenerationParams, ModelDescriptor } from "@/lib/contracts";
import type { LookResolver } from "@/lib/ports";

/**
 * The curated catalogue.
 *
 * Visitors choose a *look* — "Photoreal", "Cinematic" — never an endpoint id.
 * The endpoint is an implementation detail surfaced only under Advanced, which
 * is what lets us swap a model without changing anything a visitor understands.
 *
 * ── Endpoint verification ───────────────────────────────────────────────────
 * Every id below was checked against fal's live model catalogue on 2026-08-25.
 * They have NOT been exercised against the live API — this project runs on
 * FAL_MODE=mock and no key has been used yet. Treat the ids as verified-listed
 * but unverified-working until `scripts/smoke-live.mjs` runs on a real key.
 *
 * Deliberately excluded: Sora 2, whose API shuts down 2026-09-24.
 *
 * Four looks spanning both kinds and the speed/quality range, enough to
 * prove the picker and the
 * param-adaptation path. Adding a model is a single entry here.
 */

const LOOKS: ModelDescriptor[] = [
  {
    lookId: "quick-sketch",
    endpoint: "fal-ai/flux/schnell",
    look: "Quick Sketch",
    blurb: "Fast ideas. Good for finding a direction before you commit.",
    kind: "image",
    tier: "fast",
    supports: {
      imageInput: false,
      refImages: false,
      audio: false,
      duration: false,
      seed: true,
      negativePrompt: false,
    },
    aspectRatios: ["1:1", "16:9", "9:16", "4:3"],
    estSeconds: 3,
    estCostUsd: 0.003,
    promptStarters: [
      "a lighthouse at dusk, long exposure",
      "an empty diner at 3am, neon through rain",
      "a paper boat on black water",
      "morning fog over a pine ridge",
      "a hand reaching through a doorway of light",
      "abandoned greenhouse, overgrown",
    ],
    sampleAssetKey: "/looks/quick-sketch.png",
  },
  {
    lookId: "photoreal",
    endpoint: "fal-ai/nano-banana-pro",
    look: "Photoreal",
    blurb: "Believable light and skin. The one to use when it has to look real.",
    kind: "image",
    tier: "max",
    supports: {
      imageInput: true,
      refImages: true,
      audio: false,
      duration: false,
      seed: true,
      negativePrompt: true,
    },
    aspectRatios: ["1:1", "16:9", "9:16", "3:2", "2:3"],
    estSeconds: 12,
    estCostUsd: 0.04,
    promptStarters: [
      "portrait of a fisherman at first light, weathered face, soft window light",
      "a cup of coffee on a windowsill, condensation, overcast morning",
      "worn leather boots by a doorway, afternoon sun",
      "a market stall of citrus, midday, deep shadows",
      "rain on a car windscreen at night, headlights beyond",
      "a violin on an unmade bed",
    ],
    sampleAssetKey: "/looks/photoreal.png",
  },
  {
    lookId: "motion-sketch",
    endpoint: "fal-ai/veo3.1/fast",
    look: "Motion Sketch",
    blurb: "Quick moving drafts with sound. For testing an idea in motion.",
    kind: "video",
    tier: "fast",
    supports: {
      imageInput: true,
      refImages: false,
      audio: true,
      duration: true,
      seed: true,
      negativePrompt: false,
    },
    aspectRatios: ["16:9", "9:16"],
    estSeconds: 45,
    estCostUsd: 0.2,
    promptStarters: [
      "slow push through morning fog, trees resolving",
      "a hand opening a window, curtain lifting",
      "steam rising from a street grate at night",
      "waves arriving on black sand, overhead",
      "a candle guttering in a draught",
      "headlights sweeping across a bedroom wall",
    ],
    sampleAssetKey: "/looks/motion-sketch.png",
  },
  {
    lookId: "cinematic",
    endpoint: "fal-ai/kling-video/v3/pro/text-to-video",
    look: "Cinematic",
    blurb: "Considered camera moves, real depth of field. Slower, and worth it.",
    kind: "video",
    tier: "max",
    supports: {
      imageInput: true,
      refImages: false,
      audio: true,
      duration: true,
      seed: true,
      negativePrompt: true,
    },
    aspectRatios: ["16:9", "9:16", "1:1"],
    estSeconds: 180,
    estCostUsd: 1.4,
    promptStarters: [
      "a slow dolly along a rain-slicked street, neon reflections, shallow focus",
      "crane up over a wheat field at golden hour",
      "handheld follow through a crowded night market",
      "static wide of a lit house across a dark lake",
      "tracking shot along a train window, landscape blurring",
      "a slow tilt from wet cobbles up to a lit window",
    ],
    sampleAssetKey: "/looks/cinematic.png",
  },
];

const BY_ID = new Map(LOOKS.map((look) => [look.lookId, look]));

export const registry: LookResolver = {
  resolveLook(lookId: string): ModelDescriptor | null {
    return BY_ID.get(lookId) ?? null;
  },

  /**
   * Drops anything this model cannot honour, and clamps what it can.
   *
   * Filtering here rather than in the UI means an unsupported field can never
   * reach the provider and be rejected — the UI just doesn't render a control
   * the model has no `supports` flag for.
   */
  toProviderParams(
    descriptor: ModelDescriptor,
    params: GenerationParams,
  ): GenerationParams {
    const adapted: GenerationParams = { prompt: params.prompt };

    if (descriptor.supports.negativePrompt && params.negativePrompt !== undefined) {
      adapted.negativePrompt = params.negativePrompt;
    }
    if (descriptor.supports.seed && params.seed !== undefined) {
      adapted.seed = params.seed;
    }
    if (descriptor.supports.duration && params.durationSeconds !== undefined) {
      adapted.durationSeconds = params.durationSeconds;
    }
    if (descriptor.supports.imageInput && params.inputAssetId !== undefined) {
      adapted.inputAssetId = params.inputAssetId;
    }

    // An unsupported ratio falls back to the model's default rather than
    // failing the submit — the visitor's intent was "this shape-ish", and the
    // picker only offers valid ratios anyway.
    adapted.aspectRatio =
      params.aspectRatio && descriptor.aspectRatios.includes(params.aspectRatio)
        ? params.aspectRatio
        : descriptor.aspectRatios[0]!;

    return adapted;
  },
};

/** Every look, in picker order: image first, fast before slow. */
export const LOOK_LIST: readonly ModelDescriptor[] = LOOKS;

/** Ratio strings to a number, for locking a tile's aspect before paint. */
export function ratioToNumber(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number);
  return w && h ? w / h : 1;
}
