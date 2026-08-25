import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { GenerationParams, JobErrorCode, JobStatus } from "@/lib/contracts";

/**
 * Job tables. Owned by AGENT-04.
 *
 * `status` and `errorCode` are text columns typed through `$type<>()` rather
 * than Postgres enums: the contract in `@/lib/contracts` is the single source
 * of truth for those values, and a database enum would mean every added state
 * needs a migration in lockstep with a code change.
 */

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),

    /**
     * No foreign key yet — AGENT-03 owns the `sessions` table and adds the
     * constraint when it lands. Keeping it a plain column avoids two agents
     * editing one definition.
     */
    sessionId: text("session_id").notNull(),

    kind: text("kind").$type<"image" | "video">().notNull(),
    lookId: text("look_id").notNull(),
    modelId: text("model_id").notNull(),
    params: jsonb("params").$type<GenerationParams>().notNull(),

    status: text("status").$type<JobStatus>().notNull(),

    falRequestId: text("fal_request_id"),
    queuePosition: integer("queue_position"),

    errorCode: text("error_code").$type<JobErrorCode>(),
    errorMessage: text("error_message"),

    attempt: integer("attempt").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /** When the sweeper should next poll. Null once terminal. */
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
  },
  (table) => [
    // The library's default query: this session's jobs, newest first.
    index("jobs_session_created_idx").on(table.sessionId, sql`${table.createdAt} DESC`),

    // The sweeper's claim query lives or dies on this one.
    index("jobs_status_next_poll_idx").on(table.status, table.nextPollAt),

    // Makes a double-submit from an impatient button a no-op at the database
    // level, not merely at the application level.
    uniqueIndex("jobs_session_idempotency_idx").on(
      table.sessionId,
      table.idempotencyKey,
    ),
  ],
);

/**
 * The audit trail. Every status change appends one row, recording which
 * subsystem drove it — the evidence that answers "why did this job move?" and
 * the source of AGENT-12's webhook-versus-sweeper ratio.
 */
export const jobEvents = pgTable(
  "job_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),

    fromStatus: text("from_status").$type<JobStatus>(),
    toStatus: text("to_status").$type<JobStatus>().notNull(),

    source: text("source")
      .$type<"client" | "webhook" | "sweeper" | "system">()
      .notNull(),

    data: jsonb("data").$type<Record<string, unknown>>(),
  },
  (table) => [index("job_events_job_at_idx").on(table.jobId, table.at)],
);

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type JobEventRow = typeof jobEvents.$inferSelect;
export type NewJobEventRow = typeof jobEvents.$inferInsert;
