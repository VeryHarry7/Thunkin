import { test, expect } from "@playwright/test";

/**
 * The gate.
 *
 * This is the whole access boundary for a service whose API key spends real
 * money, so these run on every viewport rather than desktop only — a gate that
 * is unusable on a phone is a gate you will be tempted to remove.
 */

// A context with no cookies, so the gate is genuinely closed.
test.use({ storageState: { cookies: [], origins: [] } });

test("a locked visitor is sent to the gate", async ({ page }) => {
  await page.goto("/studio");
  await expect(page).toHaveURL(/\/unlock/);
  await expect(page.getByRole("heading", { name: "Locked" })).toBeVisible();
});

test("the wrong passphrase does not get in", async ({ page }) => {
  await page.goto("/unlock");
  await page.getByLabel("Passphrase").fill("definitely-not-it");
  await page.getByRole("button", { name: "Unlock" }).click();

  // Scoped to the form: Next renders its own route announcer with role="alert",
  // so an unscoped locator matches two elements and fails strict mode.
  await expect(page.locator("form").getByRole("alert")).toContainText(/not it/i);
  await expect(page).toHaveURL(/\/unlock/);
});

test("the right passphrase gets in and stays in", async ({ page }) => {
  await page.goto("/unlock");
  await page.getByLabel("Passphrase").fill("e2e-passphrase");
  await page.getByRole("button", { name: "Unlock" }).click();

  await expect(page).toHaveURL(/\/studio/);

  // The cookie has to survive a fresh navigation, or you would re-enter it on
  // every page — which on a phone is enough friction to abandon the thing.
  await page.goto("/library");
  await expect(page).toHaveURL(/\/library/);
});

test("unlocking returns you to where you were headed", async ({ page }) => {
  await page.goto("/library");
  await expect(page).toHaveURL(/\/unlock/);

  await page.getByLabel("Passphrase").fill("e2e-passphrase");
  await page.getByRole("button", { name: "Unlock" }).click();

  await expect(page).toHaveURL(/\/library/);
});

test("a locked API call gets a status, not a login page", async ({ request }) => {
  // Redirecting an API call to HTML is a confusing way to say "unauthorized",
  // and a client parsing it as JSON would fail somewhere far from the cause.
  const response = await request.get("/api/jobs");
  expect(response.status()).toBe(401);
  expect(response.headers()["content-type"]).toContain("application/json");
});

test("the fal webhook stays reachable without a cookie", async ({ request }) => {
  // fal will never hold a cookie. It authenticates with an ED25519 signature
  // over the body, which the route verifies itself — a 401 here would mean the
  // gate had locked out the one caller that cannot be let in by cookie.
  const response = await request.post("/api/webhooks/fal", {
    data: { request_id: "req_forged", status: "OK" },
  });

  // Rejected by signature verification, not by the gate.
  expect(response.status()).toBe(401);
  expect(await response.json()).toHaveProperty("reason");
});

test("the reconciler poke stays reachable without a cookie", async ({ request }) => {
  // Same reasoning as the webhook: SWEEP_SECRET is this endpoint's credential
  // and a script poking it has no cookie. This assertion exists because the
  // gate did lock it out once — every spec elsewhere runs unlocked, so nothing
  // else here would have noticed.
  const response = await request.get("/api/internal/sweep?secret=e2e-sweep-secret");
  expect(response.status()).toBe(200);
  expect((await response.json()).ok).toBe(true);
});

test("the reconciler poke still refuses a wrong secret", async ({ request }) => {
  // Exempt from the gate is not exempt from authentication.
  const response = await request.get("/api/internal/sweep?secret=not-the-secret");
  expect(response.status()).toBe(401);
});
