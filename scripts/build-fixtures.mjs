/**
 * Generates the committed placeholder imagery.
 *
 * Two jobs:
 *  1. Look samples for the picker cards (public/looks/*.png).
 *  2. Raster fixtures the mock provider returns (public/fixtures/*.png).
 *
 * The fixtures must be raster, not SVG: the asset pipeline rasterizes, derives
 * a thumbnail and computes a blur placeholder, and if the mock handed it an SVG
 * that code path would never run the way it runs in production.
 *
 * Run with: node scripts/build-fixtures.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

/** Duotone gradient fields, one per look. Abstract on purpose — these are
 *  obviously placeholders, not pretend generations. */
const LOOKS = [
  {
    name: "quick-sketch",
    from: "#1d2740",
    to: "#4a3f6b",
    accent: "#7aa2f7",
    w: 800,
    h: 800,
  },
  {
    name: "photoreal",
    from: "#2a1f1a",
    to: "#6b4a3a",
    accent: "#e0b062",
    w: 800,
    h: 800,
  },
  {
    name: "motion-sketch",
    from: "#101d24",
    to: "#2c4f56",
    accent: "#62c39a",
    w: 800,
    h: 450,
  },
  {
    name: "cinematic",
    from: "#1a1020",
    to: "#5a2b46",
    accent: "#e08a72",
    w: 800,
    h: 450,
  },
];

const FIXTURES = [
  {
    name: "mock-image",
    from: "#141824",
    to: "#3d3352",
    accent: "#ffcf8f",
    w: 1024,
    h: 1024,
  },
  {
    name: "mock-video",
    from: "#101826",
    to: "#4a2f46",
    accent: "#93b5ff",
    w: 1280,
    h: 720,
  },
];

function field({ from, to, accent, w, h, label }) {
  // A soft diagonal wash plus a couple of blurred blooms — reads as "image"
  // at thumbnail size without pretending to be a photograph.
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="bloom" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="${Math.round(w / 28)}"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <ellipse cx="${w * 0.68}" cy="${h * 0.34}" rx="${w * 0.34}" ry="${h * 0.3}" fill="url(#bloom)" filter="url(#soft)"/>
  <ellipse cx="${w * 0.22}" cy="${h * 0.76}" rx="${w * 0.26}" ry="${h * 0.22}" fill="url(#bloom)" opacity="0.5" filter="url(#soft)"/>
  <rect width="${w}" height="${h}" fill="none" stroke="${accent}" stroke-opacity="0.12" stroke-width="2"/>
  ${label ? `<text x="${w / 2}" y="${h - Math.round(h * 0.06)}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="${Math.round(w / 44)}" fill="#ffffff" fill-opacity="0.45" letter-spacing="3">${label}</text>` : ""}
</svg>`);
}

async function main() {
  await mkdir("public/looks", { recursive: true });
  await mkdir("public/fixtures", { recursive: true });

  for (const look of LOOKS) {
    const png = await sharp(field(look)).png({ quality: 90 }).toBuffer();
    await writeFile(`public/looks/${look.name}.png`, png);
    console.log(`public/looks/${look.name}.png  ${png.length} bytes`);
  }

  for (const fixture of FIXTURES) {
    const png = await sharp(field({ ...fixture, label: "FIXTURE · MOCK PROVIDER" }))
      .png({ quality: 90 })
      .toBuffer();
    await writeFile(`public/fixtures/${fixture.name}.png`, png);
    console.log(`public/fixtures/${fixture.name}.png  ${png.length} bytes`);
  }
}

await main();
