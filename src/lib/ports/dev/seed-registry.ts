import type { LookResolver } from "../types";
import type { GenerationParams, ModelDescriptor } from "@/lib/contracts";

/**
 * A two-entry stand-in registry so the generation core is runnable and
 * testable before AGENT-02's curated catalogue exists.
 *
 * These endpoints are deliberately `mock/*` rather than real fal ids: nothing
 * here should survive into production, and pointing at a real endpoint would
 * make that mistake silent. AGENT-02 replaces this wholesale.
 */

const SEED_LOOKS: ModelDescriptor[] = [
  {
    lookId: "seed-image",
    endpoint: "mock/seed-image",
    look: "Seed Image",
    blurb: "Placeholder look. AGENT-02 replaces the registry.",
    kind: "image",
    tier: "balanced",
    supports: {
      imageInput: false,
      refImages: false,
      audio: false,
      duration: false,
      seed: true,
      negativePrompt: true,
    },
    aspectRatios: ["1:1", "16:9", "9:16"],
    estSeconds: 8,
    estCostUsd: 0.02,
    promptStarters: ["a lighthouse at dusk", "a rain-slicked street at night"],
    sampleAssetKey: "/fixtures/mock-image.svg",
  },
  {
    lookId: "seed-video",
    endpoint: "mock/seed-video",
    look: "Seed Video",
    blurb: "Placeholder look. AGENT-02 replaces the registry.",
    kind: "video",
    tier: "balanced",
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
    estCostUsd: 0.4,
    promptStarters: ["a slow push through fog", "a hand opening a window"],
    sampleAssetKey: "/fixtures/mock-video.svg",
  },
];

const BY_ID = new Map(SEED_LOOKS.map((look) => [look.lookId, look]));

export const seedRegistry: LookResolver = {
  resolveLook(lookId: string): ModelDescriptor | null {
    return BY_ID.get(lookId) ?? null;
  },

  toProviderParams(
    descriptor: ModelDescriptor,
    params: GenerationParams,
  ): GenerationParams {
    // Drop anything this model cannot honour, so the provider never receives a
    // field it will reject. AGENT-02's real version also renames and rescales.
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
    if (params.aspectRatio !== undefined) {
      adapted.aspectRatio = descriptor.aspectRatios.includes(params.aspectRatio)
        ? params.aspectRatio
        : descriptor.aspectRatios[0]!;
    }

    return adapted;
  },
};

/** Exposed so tests and the dev UI can enumerate what is available. */
export const SEED_LOOK_LIST: readonly ModelDescriptor[] = SEED_LOOKS;
