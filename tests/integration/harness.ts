import { execFileSync } from "node:child_process";
import type { Server } from "node:http";
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
  // Naming every table explicitly rather than relying on the cascade — it is
  // order-proof, and it keeps Postgres from emitting a NOTICE per test.
  await db.execute(
    sql`TRUNCATE TABLE assets, job_events, jobs RESTART IDENTITY CASCADE`,
  );
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
}

/* ======================================================================
 * Fixture server
 *
 * The mock provider returns app-relative result URLs, and ingest resolves
 * them against PUBLIC_URL and fetches them over HTTP. Serving `public/` here
 * means the integration tests exercise the real download-and-store path
 * rather than a stub — which is the only way the size caps, mime allowlist
 * and derivative generation get tested at all.
 * =================================================================== */

const FIXTURE_PORT = 4599;
let fixtureServer: Server | null = null;

export async function startFixtureServer(): Promise<void> {
  if (fixtureServer) return;

  const { createServer } = await import("node:http");
  const { readFile } = await import("node:fs/promises");
  const { join, normalize } = await import("node:path");

  const root = join(process.cwd(), "public");

  const server = createServer((req, res) => {
    void (async () => {
      const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!));
      // Never let a crafted path escape public/.
      if (path.includes("..")) {
        res.writeHead(400).end();
        return;
      }

      try {
        const body = await readFile(join(root, path));
        const mime = path.endsWith(".png")
          ? "image/png"
          : path.endsWith(".svg")
            ? "image/svg+xml"
            : "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": String(body.byteLength),
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    })();
  });

  await new Promise<void>((resolve) =>
    server.listen(FIXTURE_PORT, "127.0.0.1", resolve),
  );
  fixtureServer = server;
}

export async function stopFixtureServer(): Promise<void> {
  if (!fixtureServer) return;
  const server = fixtureServer;
  fixtureServer = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
