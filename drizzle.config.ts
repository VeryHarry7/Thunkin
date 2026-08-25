import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit runs outside Next.js, so it reads .env.local itself rather than
 * going through `@/lib/env` (which would pull in the whole app's env contract
 * for a CLI that only needs one variable).
 */
process.loadEnvFile?.(".env.local");

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
