import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Unit tests live beside the code they cover; e2e is Playwright's.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**"],
    // The env contract fills in obvious fakes under NODE_ENV=test, so unit
    // tests need no .env file and can never reach a real service.
    env: { NODE_ENV: "test", FAL_MODE: "mock" },
  },
});
