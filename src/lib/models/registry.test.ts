import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LOOK_LIST, ratioToNumber, registry } from "./registry";

/**
 * The registry decides which parameters reach a paid API and in what shape.
 * It went untested for its whole life before this file — the exact module
 * where a silent mistake costs money rather than a stack trace.
 */

const look = (id: string) => {
  const found = registry.resolveLook(id);
  expect(found, id).not.toBeNull();
  return found!;
};

describe("resolveLook", () => {
  it("finds every listed look and rejects the rest", () => {
    for (const entry of LOOK_LIST) {
      expect(registry.resolveLook(entry.lookId)?.endpoint).toBe(entry.endpoint);
    }
    expect(registry.resolveLook("does-not-exist")).toBeNull();
  });
});

describe("normalizeParams", () => {
  it("drops fields the model does not support", () => {
    // quick-sketch supports seed but not negativePrompt, duration, or image
    // input — none of those may survive to be stored or sent.
    const normalized = registry.normalizeParams(look("quick-sketch"), {
      prompt: "a lighthouse",
      negativePrompt: "blurry",
      seed: 7,
      durationSeconds: 5,
      inputAssetId: "ast_1",
    });

    expect(normalized).toEqual({
      prompt: "a lighthouse",
      seed: 7,
      aspectRatio: "1:1",
    });
  });

  it("keeps everything a fully-featured model supports", () => {
    const normalized = registry.normalizeParams(look("cinematic"), {
      prompt: "a slow dolly",
      negativePrompt: "shaky",
      seed: 9,
      durationSeconds: 10,
      aspectRatio: "9:16",
    });

    expect(normalized).toEqual({
      prompt: "a slow dolly",
      negativePrompt: "shaky",
      seed: 9,
      durationSeconds: 10,
      aspectRatio: "9:16",
    });
  });

  it("clamps an unsupported ratio to the model's default", () => {
    const normalized = registry.normalizeParams(look("motion-sketch"), {
      prompt: "fog",
      aspectRatio: "4:3", // motion-sketch offers only 16:9 and 9:16
    });
    expect(normalized.aspectRatio).toBe("16:9");
  });
});

describe("payload adapters", () => {
  it("flux: aspect ratio becomes a named image_size, never aspect_ratio", () => {
    const payload = registry.toProviderParams(look("quick-sketch"), {
      prompt: "a lighthouse",
      aspectRatio: "16:9",
      seed: 7,
    });

    expect(payload).toEqual({
      prompt: "a lighthouse",
      image_size: "landscape_16_9",
      seed: 7,
    });
  });

  it("flux: maps every ratio the look offers", () => {
    for (const [ratio, size] of [
      ["1:1", "square_hd"],
      ["16:9", "landscape_16_9"],
      ["9:16", "portrait_16_9"],
      ["4:3", "landscape_4_3"],
    ] as const) {
      const payload = registry.toProviderParams(look("quick-sketch"), {
        prompt: "x",
        aspectRatio: ratio,
      });
      expect(payload.image_size, ratio).toBe(size);
    }
  });

  it("veo: duration is a labelled string", () => {
    const payload = registry.toProviderParams(look("motion-sketch"), {
      prompt: "fog",
      aspectRatio: "16:9",
      durationSeconds: 8,
    });
    expect(payload.duration).toBe("8s");
    expect(payload.aspect_ratio).toBe("16:9");
  });

  it("kling: duration is a bare numeric string", () => {
    const payload = registry.toProviderParams(look("cinematic"), {
      prompt: "a slow dolly",
      aspectRatio: "16:9",
      durationSeconds: 10,
      negativePrompt: "shaky",
    });
    expect(payload).toEqual({
      prompt: "a slow dolly",
      aspect_ratio: "16:9",
      duration: "10",
      negative_prompt: "shaky",
    });
  });

  it("default: photoreal gets the common shape", () => {
    const payload = registry.toProviderParams(look("photoreal"), {
      prompt: "a violin",
      aspectRatio: "3:2",
      negativePrompt: "cartoonish",
      seed: 3,
    });
    expect(payload).toEqual({
      prompt: "a violin",
      aspect_ratio: "3:2",
      negative_prompt: "cartoonish",
      seed: 3,
    });
  });

  it("never emits image_url from an asset id", () => {
    // The old shared mapper sent params.inputAssetId verbatim as image_url —
    // an asset id is not a URL, and fal could never fetch a LAN one anyway.
    // Reference delivery is a per-adapter concern (docs/BACKLOG.md).
    for (const entry of LOOK_LIST) {
      const payload = registry.toProviderParams(entry, {
        prompt: "x",
        inputAssetId: "ast_123",
      });
      expect("image_url" in payload, entry.lookId).toBe(false);
      expect(Object.values(payload)).not.toContain("ast_123");
    }
  });

  it("normalize-then-adapt round trip drops what support flags forbid", () => {
    // The pipeline as the service actually runs it.
    const descriptor = look("quick-sketch");
    const payload = registry.toProviderParams(
      descriptor,
      registry.normalizeParams(descriptor, {
        prompt: "a lighthouse",
        negativePrompt: "blurry", // unsupported → gone before the adapter
        durationSeconds: 5, // unsupported → gone
      }),
    );
    expect(payload).toEqual({ prompt: "a lighthouse", image_size: "square_hd" });
  });
});

describe("ratioToNumber", () => {
  it("parses ratios and shrugs at garbage", () => {
    expect(ratioToNumber("16:9")).toBeCloseTo(16 / 9);
    expect(ratioToNumber("1:1")).toBe(1);
    expect(ratioToNumber("nonsense")).toBe(1);
  });
});

describe("the live smoke script", () => {
  it("mirrors the registry's endpoints exactly", () => {
    // scripts/smoke-live.mjs cannot import this module (plain Node, no `@/`
    // alias), so it carries its own copy of the list. This is the tripwire
    // that keeps the copy honest: swap a model here and the smoke must learn
    // about it in the same commit.
    const script = readFileSync("scripts/smoke-live.mjs", "utf8");
    const scripted = [...script.matchAll(/endpoint:\s*"([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(new Set(scripted)).toEqual(new Set(LOOK_LIST.map((l) => l.endpoint)));
  });
});
