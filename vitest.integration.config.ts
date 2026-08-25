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
    env: { NODE_ENV: "test", FAL_MODE: "mock" },
  },
});
