import { defineConfig, devices } from "@playwright/test";
import type { PlaywrightTestConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Some environments (CI images, this repo's dev container) ship a prebuilt
 * Chromium whose revision does not match the one our Playwright version
 * expects. When that stable symlink exists, point at it rather than
 * downloading a second browser.
 */
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const launchOptions = existsSync(PREINSTALLED_CHROMIUM)
  ? { executablePath: PREINSTALLED_CHROMIUM }
  : {};

type Use = NonNullable<PlaywrightTestConfig["use"]>;

/**
 * Device profiles default to WebKit for Apple hardware, but Chromium is the
 * only engine available here. We keep the viewport, touch behaviour and user
 * agent from the profile and run it under Chromium — enough to catch the
 * layout and ergonomics regressions the phone-first goal cares about. Real
 * Safari rendering bugs need a manual pass; that is a known limitation.
 */
function profile(device: Use): Use {
  return { ...device, browserName: "chromium", launchOptions };
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: { baseURL: BASE_URL, trace: "on-first-retry" },

  /**
   * Two kinds of spec, deliberately split.
   *
   * API specs exercise route handlers over HTTP — a second viewport tells you
   * nothing about a JSON response, and running them across the whole device
   * matrix was most of the suite's cost. They run on desktop only.
   *
   * UI specs run everywhere, because layout and ergonomics are exactly what a
   * viewport changes. That matrix is the phone-ergonomics checklist made executable.
   */
  projects: [
    {
      name: "api",
      testMatch: /generation\.spec\.ts/,
      use: profile(devices["Desktop Chrome"]),
    },

    {
      name: "desktop",
      testIgnore: /generation\.spec\.ts/,
      use: profile(devices["Desktop Chrome"]),
    },
    {
      name: "iphone-se",
      testIgnore: /generation\.spec\.ts/,
      use: profile(devices["iPhone SE"]),
    },
    {
      name: "iphone-15-pro",
      testIgnore: /generation\.spec\.ts/,
      use: profile(devices["iPhone 15 Pro"]),
    },
    {
      name: "pixel-8",
      testIgnore: /generation\.spec\.ts/,
      use: profile(devices["Pixel 7"]),
    },
    {
      name: "ipad",
      testIgnore: /generation\.spec\.ts/,
      use: profile(devices["iPad (gen 7)"]),
    },
  ],

  webServer: {
    // Always mock: the e2e suite must never make a billable call.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      FAL_MODE: "mock",
      PORT: String(PORT),
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/thunkin",
      SESSION_SECRET: "e2e-session-secret-not-for-any-real-deployment",
      SWEEP_SECRET: "e2e-sweep-secret",
      // The gate the suite unlocks through, so it is exercised rather than
      // bypassed on every run.
      APP_PASSPHRASE: "e2e-passphrase",
      // Mock mode, so this is never sent anywhere.
      FAL_KEY: "e2etestkey:e2etestsecret",
      PUBLIC_URL: BASE_URL,
    },
  },
});
