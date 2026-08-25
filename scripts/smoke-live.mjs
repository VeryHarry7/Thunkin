/**
 * The live smoke test.
 *
 * Every fal endpoint id in the registry was verified as *listed* in fal's
 * catalogue. None has been exercised against the live API — this project runs
 * on FAL_MODE=mock and no key has ever been used. This script is what turns
 * "listed" into "working".
 *
 * It costs real money: one image and, unless you skip it, one video. The video
 * is the expensive one, so it is opt-in.
 *
 *   node scripts/smoke-live.mjs            # image only  (~$0.01)
 *   node scripts/smoke-live.mjs --video    # image + video (~$1.50)
 *
 * Reads FAL_KEY from .env.local or the environment. Expect an id or two to be
 * wrong — that is the point of running it.
 */
import { setTimeout as sleep } from "node:timers/promises";

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

/** Mirrors src/lib/models/registry.ts. Keep them in step. */
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

async function waitFor(endpoint, requestId, ceilingMs) {
  const deadline = Date.now() + ceilingMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${QUEUE}/${endpoint}/requests/${requestId}/status`, {
      headers,
    });
    const body = await response.json();

    if (body.status === "COMPLETED") {
      const result = await fetch(`${QUEUE}/${endpoint}/requests/${requestId}`, {
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

if (failures.length > 0) {
  console.log(
    `${failures.length} endpoint(s) need fixing in src/lib/models/registry.ts:`,
  );
  for (const [endpoint, reason] of failures) console.log(`  ${endpoint} — ${reason}`);
  process.exit(1);
}

console.log("All smoked endpoints work. The registry ids are real.");
