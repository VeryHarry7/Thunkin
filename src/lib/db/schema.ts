/**
 * Database schema.
 *
 * Wave 0 deliberately ships this file empty of tables. Each table belongs to
 * the agent that owns its lifecycle, and defining them here up front would
 * mean four agents editing one file:
 *
 *   sessions            → AGENT-03 (Key Vault)
 *   jobs, job_events    → AGENT-04 (Generation Core)
 *   assets, shares      → AGENT-05 (Asset Pipeline) and AGENT-08 (Share)
 *
 * Each agent adds its tables in its own module under `src/lib/db/tables/` and
 * re-exports them from here, so `drizzle-kit` sees one schema surface while
 * ownership stays split. The column lists are specified in docs/ARCHITECTURE.md.
 */

// Intentionally empty until Wave 1. Re-export table modules below as they land:
//   export * from "./tables/sessions";
//   export * from "./tables/jobs";

export {};
