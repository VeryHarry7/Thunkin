import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * The database handle.
 *
 * Next.js reloads modules aggressively in development, which would otherwise
 * open a new pool on every edit until Postgres refuses connections. Caching on
 * globalThis keeps one pool across reloads.
 */
const globalForDb = globalThis as unknown as {
  __thunkinSql?: ReturnType<typeof postgres>;
};

function createClient() {
  return postgres(env.DATABASE_URL, {
    // Route handlers are short-lived and there is exactly one user; a small
    // pool is plenty for the Postgres running on the same box.
    max: env.NODE_ENV === "production" ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

const sql = globalForDb.__thunkinSql ?? createClient();
if (env.NODE_ENV !== "production") {
  globalForDb.__thunkinSql = sql;
}

export const db = drizzle(sql, { schema });
export { sql, schema };
export type Db = typeof db;
