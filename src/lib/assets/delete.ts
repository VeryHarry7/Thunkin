import { eq } from "drizzle-orm";
import { db, type Db } from "@/lib/db";
import { assets } from "@/lib/db/tables/assets";
import { jobs } from "@/lib/db/tables/jobs";
import { getStorage } from "@/lib/storage";

/**
 * Deleting a generation.
 *
 * Bytes first, then rows. The other order can leave a row pointing at a file
 * that is already gone, which renders as a broken tile; this order can at worst
 * leave an orphaned file, which is invisible and reclaimable.
 */
export async function deleteJob(jobId: string, client: Db = db): Promise<boolean> {
  const rows = await client.select().from(assets).where(eq(assets.jobId, jobId));

  const storage = getStorage();
  for (const row of rows) {
    // Best effort: a missing file should not block removing the record of it.
    await storage.delete(row.storageKey).catch(() => {});
  }

  // assets and job_events both cascade from jobs.
  const deleted = await client.delete(jobs).where(eq(jobs.id, jobId)).returning();
  return deleted.length > 0;
}
