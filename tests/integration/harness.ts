import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

/**
 * Integration test harness.
 *
 * Connects to whatever `DATABASE_URL` points at, creates the tables, and
 * truncates between tests. If no database is reachable the suite **skips**
 * rather than fails, so a contributor without Postgres running still gets a
 * useful `pnpm test`.
 */

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/thunkin";

let client: ReturnType<typeof postgres> | null = null;

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** True when a database is reachable. Used to skip rather than fail. */
export async function databaseAvailable(): Promise<boolean> {
  try {
    const probe = postgres(DATABASE_URL, { max: 1, connect_timeout: 3 });
    await probe`select 1`;
    await probe.end({ timeout: 1 });
    return true;
  } catch {
    return false;
  }
}

export function getClient() {
  client ??= postgres(DATABASE_URL, { max: 5, connect_timeout: 5 });
  return client;
}

export function getDb(): TestDb {
  return drizzle(getClient(), { schema });
}

/**
 * Creates the schema.
 *
 * Uses drizzle-kit push so the tables always match the definitions in code —
 * a hand-maintained DDL copy here would drift and start testing the wrong shape.
 */
export function pushSchema(): void {
  execFileSync("pnpm", ["exec", "drizzle-kit", "push", "--force"], {
    env: { ...process.env, DATABASE_URL },
    stdio: "pipe",
  });
}

export async function truncateAll(): Promise<void> {
  const db = getDb();
  // job_events cascades from jobs, but naming both is explicit and order-proof.
  await db.execute(sql`TRUNCATE TABLE job_events, jobs RESTART IDENTITY CASCADE`);
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
}
