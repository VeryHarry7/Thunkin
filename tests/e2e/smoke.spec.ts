import { test, expect } from "@playwright/test";

/**
 * Wave 0 smoke. Proves the app boots, renders, and resolves its env contract
 * on every device profile. AGENT-06 and AGENT-09 replace this with real
 * journeys through the core loop.
 */
test("the app boots and renders the placeholder", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Thunkin" })).toBeVisible();

  // The env contract resolved and the provider is mocked — no billable call
  // can happen during a test run.
  await expect(page.getByText("provider: mock")).toBeVisible();
});

test("the page never scrolls sideways", async ({ page }) => {
  await page.goto("/");

  // A promise the whole product makes, so it is worth asserting from day one
  // on every viewport in the matrix rather than discovering it on a phone.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
