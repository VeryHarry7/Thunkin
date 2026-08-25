/**
 * Database schema.
 *
 * Each table gets a module under `src/lib/db/tables/` re-exported here, so
 * `drizzle-kit` sees a single schema surface without one file growing to hold
 * everything.
 *
 *   jobs, job_events    generation lifecycle
 *   assets              what a finished job produced
 */

export * from "./tables/jobs";
export * from "./tables/assets";
