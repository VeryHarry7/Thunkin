import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { jobs } from "./jobs";
import type { JobKind } from "@/lib/contracts";

/**
 * Assets.
 *
 * One row per produced file, after it has been copied into our own storage.
 * A row existing means the bytes are ours and will still be there tomorrow —
 * which is the entire point, since provider URLs expire.
 */
export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    kind: text("kind").$type<JobKind>().notNull(),

    /** Opaque storage key. Never leaves the server — see PublicAsset. */
    storageKey: text("storage_key").notNull(),
    /** Poster frame for video. */
    /**
     * Tiny base64 data URI, inlined into HTML so a tile paints before any bytes
     * arrive. Kept small enough that it costs less than the request it saves.
     */
    blurPlaceholder: text("blur_placeholder"),

    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    durationMs: integer("duration_ms"),
    bytes: integer("bytes").notNull(),
    /** Detects a truncated or corrupted ingest. */
    checksum: text("checksum"),

    /** The provider URL we copied from. Expires — kept for debugging only. */
    sourceUrl: text("source_url"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("assets_job_idx").on(table.jobId),
    index("assets_session_ingested_idx").on(table.sessionId, table.ingestedAt),
  ],
);

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
