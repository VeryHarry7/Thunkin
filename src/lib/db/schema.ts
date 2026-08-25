/**
 * Database schema.
 *
 * Each table belongs to the agent that owns its lifecycle. Rather than one
 * shared file that four agents edit, each adds a module under
 * `src/lib/db/tables/` and re-exports it here, so `drizzle-kit` sees a single
 * schema surface while ownership stays split:
 *
 *   sessions            → AGENT-03 (Key Vault)
 *   jobs, job_events    → AGENT-04 (Generation Core)   ✓ landed
 *   assets              → AGENT-05 (Asset Pipeline)    ✓ landed
 *   shares              → AGENT-08 (Library & Share)
 */

export * from "./tables/jobs";
export * from "./tables/assets";
