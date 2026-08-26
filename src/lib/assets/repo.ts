import { desc, eq, inArray } from "drizzle-orm";
import { db, type Db } from "@/lib/db";
import { assets, type AssetRow } from "@/lib/db/tables/assets";
import type { PublicAsset } from "@/lib/contracts";

/**
 * Reading assets back.
 *
 * `toPublicAsset` is the boundary that keeps `storageKey`, `sourceUrl` and
 * `sessionId` server-side. The client gets an opaque `/api/assets/{id}` URL, so
 * the bucket layout is never public information.
 */
export function toPublicAsset(row: AssetRow): PublicAsset {
  return {
    id: row.id,
    kind: row.kind,
    url: `/api/assets/${row.id}`,
    blurPlaceholder: row.blurPlaceholder,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
  };
}

/**
 * One asset.
 *
 * Unscoped, matching `getJob`: an unlocked caller is the owner regardless of
 * which device they are on. A missing asset is still a 404, never a 403 —
 * absence should not confirm existence.
 */
export async function getAsset(
  assetId: string,
  client: Db = db,
): Promise<AssetRow | null> {
  const rows = await client
    .select()
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);

  return rows[0] ?? null;
}

/** Assets for a set of jobs, newest first, grouped by job id. */
export async function assetsForJobs(
  jobIds: string[],
  client: Db = db,
): Promise<Map<string, PublicAsset[]>> {
  const grouped = new Map<string, PublicAsset[]>();
  if (jobIds.length === 0) return grouped;

  const rows = await client
    .select()
    .from(assets)
    .where(inArray(assets.jobId, jobIds))
    .orderBy(desc(assets.ingestedAt));

  for (const row of rows) {
    const list = grouped.get(row.jobId) ?? [];
    list.push(toPublicAsset(row));
    grouped.set(row.jobId, list);
  }

  return grouped;
}
