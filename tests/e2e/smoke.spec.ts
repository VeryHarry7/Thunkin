import { test, expect } from "@playwright/test";

/**
 * Runs on every viewport in the matrix. These are the assertions that only a
 * real device width can make.
 */

const PAGES = ["/", "/studio", "/library"];

// The gate stands in front of everything; unlock once per context.
test.beforeEach(async ({ page }) => {
  await page.goto("/unlock");
  await page.getByLabel("Passphrase").fill("e2e-passphrase");
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/unlock"));
});

for (const path of PAGES) {
  test(`${path} renders`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText("Thunkin").first()).toBeVisible();
  });

  test(`${path} never scrolls sideways`, async ({ page }) => {
    await page.goto(path);
    // Measure settled layout: a font swapping in changes text metrics, and a
    // mid-swap frame is not what a person ever sees.
    await page.evaluate(() => document.fonts.ready);

    /*
     * A promise the whole product makes, and one that has already been broken
     * once: flex children inside a grid default to min-content width, so a long
     * chip or a look card silently forces the page open. Worth asserting on
     * every viewport rather than trusting a desktop eyeball.
     */
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, `${path} overflows horizontally`).toBe(false);
  });
}

test("the studio offers looks and a way to generate", async ({ page }) => {
  await page.goto("/studio");

  await expect(page.getByRole("radio", { name: /quick sketch/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate" })).toBeVisible();
  // Disabled with a stated reason, never a dead end.
  await expect(page.getByText("Describe something first")).toBeVisible();
});
