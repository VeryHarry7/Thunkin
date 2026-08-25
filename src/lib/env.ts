import { z } from "zod";

/**
 * The environment contract.
 *
 * Validated once, at module load, so a misconfigured deploy fails at boot with
 * a readable list of what is wrong — never at 3am inside a webhook handler.
 *
 * Adding a variable is a two-step change: add it here, then add it to
 * `.env.example` with a comment explaining where the value comes from.
 */

/** How the provider adapter resolves generation requests. */
export const FalMode = z.enum(["mock", "live"]);
export type FalMode = z.infer<typeof FalMode>;

/**
 * A 32-byte key, base64-encoded, used by AGENT-03's vault to encrypt the
 * user-supplied fal key at rest. Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
const base64Key32 = z.string().refine(
  (value) => {
    try {
      return Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  },
  { message: "must be 32 bytes, base64-encoded (see .env.example)" },
);

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Postgres connection string. */
  DATABASE_URL: z.string().min(1, "required — see .env.example"),

  /** Encrypts the user's fal key at rest. Rotating it invalidates stored keys. */
  MASTER_KEY: base64Key32,

  /** Signs the anonymous session cookie. */
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),

  /**
   * The app's externally reachable origin. fal posts webhooks here, so it must
   * be a real public URL in any environment that talks to live fal — a private
   * or loopback address gets its deliveries dropped permanently.
   */
  PUBLIC_URL: z.url(),

  /** Shared secret guarding /api/internal/sweep against public invocation. */
  SWEEP_SECRET: z.string().min(16, "must be at least 16 characters"),

  FAL_MODE: FalMode.default("mock"),

  /**
   * A fal key for local development only, so the generation core is runnable
   * before AGENT-03's vault exists.
   *
   * The dev key resolver that reads this **refuses to run in production** — a
   * real deployment gets its key from the visitor, through the vault, never
   * from configuration. Listed here so all config is visible in one place, not
   * because it is a supported production variable.
   */
  DEV_FAL_KEY: z.string().optional(),

  // Object storage — AGENT-05 consumes these.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_HOST: z.string().optional(),
});

export type Env = z.infer<typeof serverSchema>;

/**
 * Defaults used when NODE_ENV=test so unit tests need no .env file. These are
 * deliberately obvious fakes — anything that reaches a real service in tests
 * is a bug in the test, not a missing variable.
 */
const testDefaults: Record<string, string> = {
  DATABASE_URL: "postgres://thunkin:thunkin@localhost:5432/thunkin_test",
  MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  SESSION_SECRET: "test-session-secret-not-for-any-real-deployment",
  PUBLIC_URL: "http://localhost:3000",
  SWEEP_SECRET: "test-sweep-secret-value",
  FAL_MODE: "mock",
};

function load(): Env {
  const source =
    process.env.NODE_ENV === "test" ? { ...testDefaults, ...process.env } : process.env;

  const parsed = serverSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.`,
    );
  }

  return parsed.data;
}

export const env: Env = load();

/** True when the provider adapter should never make a billable call. */
export const isMockProvider = env.FAL_MODE === "mock";
