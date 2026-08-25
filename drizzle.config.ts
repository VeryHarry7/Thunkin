import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit runs outside Next.js, so it reads .env.local itself rather than
 * going through `@/lib/env` (which would pull in the whole app's env contract
 * for a CLI that only needs one variable).
 */
// loadEnvFile throws when the file is absent, which is a perfectly normal case
// (CI, or a shell that already exports DATABASE_URL). Missing is not an error.
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // No .env.local — fall through to whatever the environment already provides.
}

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
