# Backlog

Decisions already made, waiting on the work — so a future feature starts with
a design already written down instead of a re-investigation.

## Image-to-image / reference inputs (next up)

- **Delivery: fal's storage upload API** (initiate upload → PUT bytes → get a
  CDN URL fal can always fetch). Chosen over base64 data URIs (33% bloat,
  per-model size caps) and over serving from `PUBLIC_URL` (a LAN address fal
  can _never_ reach — the same fact that shapes the webhook design).
- **Contract: `refImages: string[]` of asset ids**, superseding the untouched
  `inputAssetId` field. `ModelSupports.refImages` already exists to gate it.
  Single-image models take `refImages[0]`; each look's payload adapter in
  `src/lib/models/registry.ts` maps the uploaded URL(s) into that model's
  field (`image_url`, `image_urls`, …).
- Needs: an upload route (multipart, behind the gate), a dropzone in the
  composer, and ingesting uploads into `.storage/` so a reference is kept
  alongside what it produced.

## Persist the seed a generation actually ran on

`ResultPayload.seed` comes back from both adapters and is currently dropped in
ingest. "Make a variation of this" needs it stored — one column on `assets`
(or `jobs`) plus a migration. Do it as part of the first variations feature.

## The landing wall should show your own work

`src/app/page.tsx` builds its hero wall from the registry's sample images,
because a first-time visitor has none of their own. Once a library of real
generations exists, a curated pick of them should replace the samples — the
layout takes any list of image URLs.

## Poster frames for video tiles

Removed end-to-end (the plumbing existed but nothing ever produced one — sharp
cannot read video). If video tiles ever need a real poster, that is an ffmpeg
dependency in ingest, a new nullable column, and a migration.
