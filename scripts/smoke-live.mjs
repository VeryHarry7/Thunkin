/**
 * The live smoke test.
 *
 * Turns "listed in fal's catalogue" into "actually works". Both image
 * endpoints have now passed it; the two video endpoints have not been called
 * for real yet, since the video run costs about a hundred and sixty times what
 * the image run does.
 *
 * It costs real money: one image and, unless you skip it, one video. The video
 * is the expensive one, so it is opt-in.
 *
 *   node scripts/smoke-live.mjs            # image only  (~$0.01)
 *   node scripts/smoke-live.mjs --video    # image + video (~$1.50)
 *
 * Reads FAL_KEY from .env.local or the environment. A wrong id, a renamed
 * field, a queue route that 405s — this is where those surface, and it has
 * caught all three.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { verdict } from "./smoke-verdict.mjs";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // No .env.local; fall through to the ambient environment.
}

const KEY = process.env.FAL_KEY;
if (!KEY) {
  console.error("FAL_KEY is not set. Put it in .env.local or the environment.");
  process.exit(1);
}

const QUEUE = "https://queue.fal.run";
const wantVideo = process.argv.includes("--video");

/**
 * Mirrors src/lib/models/registry.ts — this script runs under plain Node with
 * no `@/` alias, so it carries a copy. A unit test (registry.test.ts, "the
 * live smoke script") fails the build if the two lists ever disagree.
 */
const LOOKS = [
  { look: "Quick Sketch", endpoint: "fal-ai/flux/schnell", kind: "image" },
  { look: "Photoreal", endpoint: "fal-ai/nano-banana-pro", kind: "image" },
  { look: "Motion Sketch", endpoint: "fal-ai/veo3.1/fast", kind: "video" },
  {
    look: "Cinematic",
    endpoint: "fal-ai/kling-video/v3/pro/text-to-video",
    kind: "video",
  },
];

const headers = {
  Authorization: `Key ${KEY}`,
  "Content-Type": "application/json",
};

async function submit(endpoint, prompt) {
  const response = await fetch(`${QUEUE}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  const parsed = JSON.parse(body);
  if (!parsed.request_id) throw new Error(`no request_id in: ${body.slice(0, 200)}`);
  return parsed.request_id;
}

/** Mirrors queueAppId() in src/lib/provider/fal.ts — see the note there. */
function appId(endpoint) {
  return endpoint.split("/").slice(0, 2).join("/");
}

async function waitFor(endpoint, requestId, ceilingMs) {
  const deadline = Date.now() + ceilingMs;
  const app = appId(endpoint);

  while (Date.now() < deadline) {
    const response = await fetch(`${QUEUE}/${app}/requests/${requestId}/status`, {
      headers,
    });
    const body = await response.json();

    if (body.status === "COMPLETED") {
      const result = await fetch(`${QUEUE}/${app}/requests/${requestId}`, {
        headers,
      });
      return result.json();
    }
    if (body.status !== "IN_QUEUE" && body.status !== "IN_PROGRESS") {
      throw new Error(`unexpected status: ${JSON.stringify(body).slice(0, 200)}`);
    }

    process.stdout.write(".");
    await sleep(3000);
  }

  throw new Error("timed out");
}

/** Pulls whatever URL a result carries, whichever shape the model uses. */
function firstUrl(result) {
  if (Array.isArray(result?.images) && result.images[0]?.url)
    return result.images[0].url;
  if (result?.video?.url) return result.video.url;
  return null;
}

const targets = LOOKS.filter((look) => look.kind === "image" || wantVideo);
const failures = [];

console.log(
  `Smoking ${targets.length} endpoint(s)${wantVideo ? "" : " — image only, pass --video for the rest"}\n`,
);

for (const target of targets) {
  process.stdout.write(`${target.look.padEnd(16)} ${target.endpoint}\n  `);
  const started = Date.now();

  try {
    const requestId = await submit(
      target.endpoint,
      "a lighthouse at dusk, long exposure",
    );
    const result = await waitFor(
      target.endpoint,
      requestId,
      target.kind === "video" ? 600_000 : 180_000,
    );
    const url = firstUrl(result);
    const seconds = Math.round((Date.now() - started) / 1000);

    if (!url) {
      failures.push([target.endpoint, "completed but no output url"]);
      console.log(`\n  ⚠ completed in ${seconds}s but produced no url\n`);
    } else {
      console.log(`\n  ✓ ${seconds}s → ${url}\n`);
    }
  } catch (error) {
    failures.push([target.endpoint, error.message]);
    console.log(`\n  ✗ ${error.message}\n`);
  }
}

const outcome = verdict({
  attempted: targets.map((target) => target.endpoint),
  failures,
});

for (const line of outcome.lines) console.log(line);

// Not process.exit(): on Windows that trips a libuv assertion when handles
// are still closing. Setting the code lets the loop drain and exit cleanly.
if (!outcome.ok) process.exitCode = 1;
