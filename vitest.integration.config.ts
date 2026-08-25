import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration tests, against a real Postgres.
 *
 * Separate from the unit config because these need a database and are slower.
 * `pnpm test` stays instant and infrastructure-free; this is the suite that
 * proves the reconciler actually works.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Each file gets its own schema, but transactions and locks still make
    // parallel files a source of confusing interference. Serial is fast enough.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    /*
     * PUBLIC_URL points at the fixture server the harness starts. The mock
     * provider returns app-relative result URLs, and ingest resolves them
     * against PUBLIC_URL — so this is what lets the real ingest path run over
     * real HTTP instead of being stubbed out.
     */
    env: {
      NODE_ENV: "test",
      FAL_MODE: "mock",
      PUBLIC_URL: "http://127.0.0.1:4599",
      /*
       * The harness and the application code must agree on which database
       * they are talking to. The harness defaults to what `scripts/dev-db.sh`
       * manages; the env contract's test defaults point somewhere else
       * entirely, so without this the harness creates tables on one server
       * while the code under test writes to another and every case fails with
       * a connection error instead of skipping.
       */
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/thunkin",
    },
  },
});
