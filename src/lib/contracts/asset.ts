import { z } from "zod";
import { Job, JobKind } from "./job";

/**
 * A generated result, re-hosted in our own storage.
 *
 * FROZEN CONTRACT — AGENT-05 owns the ingest that populates these; AGENT-06
 * and AGENT-08 render them. The `sourceUrl` is kept only for debugging: it
 * points at the provider's expiring URL and must never be rendered.
 */
export const Asset = z.object({
  id: z.string(),
  jobId: z.string(),
  sessionId: z.string(),
  kind: JobKind,

  /** Object-storage key for the full-resolution result. */
  storageKey: z.string(),
  /** Object-storage key for the poster frame. Video only. */
  posterKey: z.string().nullable(),
  /**
   * Tiny base64 placeholder, inlined into HTML so a tile paints before any
   * bytes arrive. Kept small enough that it costs less than the request saves.
   */
  blurPlaceholder: z.string().nullable(),

  mime: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Video only. */
  durationMs: z.number().int().positive().nullable(),
  bytes: z.number().int().nonnegative(),
  /** Detects a truncated or corrupted ingest. */
  checksum: z.string().nullable(),

  /** The provider URL we copied from. Expires — never render this. */
  sourceUrl: z.string().nullable(),
  ingestedAt: z.date(),
});
export type Asset = z.infer<typeof Asset>;

/**
 * An asset as the client sees it.
 *
 * Note what is absent: `storageKey`, `sourceUrl`, and `sessionId` never cross
 * this boundary. The client gets opaque, signed, short-lived URLs instead.
 */
export const PublicAsset = z.object({
  id: z.string(),
  kind: JobKind,
  url: z.string(),
  posterUrl: z.string().nullable(),
  blurPlaceholder: z.string().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().positive().nullable(),
});
export type PublicAsset = z.infer<typeof PublicAsset>;

/**
 * A job plus what it produced.
 *
 * The shape every client-facing job endpoint returns. Additive over `Job` — a
 * job with no assets yet simply carries an empty array, so the UI can render a
 * pending tile and a finished one from the same value without branching on
 * whether a field exists.
 */
export const JobWithAssets = Job.extend({
  assets: z.array(PublicAsset),
});
export type JobWithAssets = z.infer<typeof JobWithAssets>;

/** A public, revocable link to a single asset. */
export const Share = z.object({
  slug: z.string(),
  assetId: z.string(),
  createdAt: z.date(),
  expiresAt: z.date().nullable(),
  revoked: z.boolean(),
});
export type Share = z.infer<typeof Share>;
