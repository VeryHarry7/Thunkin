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

const serverSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    /** Postgres connection string. */
    DATABASE_URL: z.string().min(1, "required — see .env.example"),

    /**
     * Signs the session cookie and the unlock cookie.
     *
     * Rotating it logs every device out, which is a safe and occasionally
     * useful thing to do.
     */
    SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),

    /**
     * The single passphrase that gets you in.
     *
     * This is the whole access boundary: anyone on the network who has it can
     * generate, and generation spends real money on `FAL_KEY`. Treat it like a
     * password, not a formality.
     */
    APP_PASSPHRASE: z.string().min(8, "must be at least 8 characters"),

    /**
     * The origin this app is reached at — e.g. `http://192.168.1.20:3000`.
     *
     * Used to resolve provider result URLs and to decide whether fal could
     * reach us with a webhook at all. A private address is expected and
     * supported; see `src/lib/net/reachability.ts`.
     */
    PUBLIC_URL: z.url(),

    /** Guards /api/internal/sweep so the reconciler is not publicly pokeable. */
    SWEEP_SECRET: z.string().min(16, "must be at least 16 characters"),

    FAL_MODE: FalMode.default("mock"),

    /**
     * The fal API key every generation runs on.
     *
     * Single-user service: one key, held server-side, never shown to a browser.
     * Optional under `FAL_MODE=mock` because nothing leaves the process there.
     *
     * An empty value means unset. `.env.example` ships the line as `FAL_KEY=`,
     * so without this an untouched copy would satisfy `live` mode's check and
     * then fail on the first generation instead of at boot.
     */
    FAL_KEY: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value : undefined)),
  })
  .superRefine((value, ctx) => {
    // Catching this at boot beats discovering it when the first real
    // generation fails, which is exactly the kind of thing that only shows up
    // in production.
    if (value.FAL_MODE === "live" && !value.FAL_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["FAL_KEY"],
        message: "required when FAL_MODE=live",
      });
    }
  });

export type Env = z.infer<typeof serverSchema>;

/**
 * Defaults used when NODE_ENV=test so unit tests need no .env file. These are
 * deliberately obvious fakes — anything that reaches a real service in tests
 * is a bug in the test, not a missing variable.
 */
const testDefaults: Record<string, string> = {
  DATABASE_URL: "postgres://thunkin:thunkin@localhost:5432/thunkin_test",
  SESSION_SECRET: "test-session-secret-not-for-any-real-deployment",
  APP_PASSPHRASE: "test-passphrase",
  PUBLIC_URL: "http://localhost:3000",
  SWEEP_SECRET: "test-sweep-secret-value",
  FAL_MODE: "mock",
  FAL_KEY: "testkey123:testsecret456",
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
