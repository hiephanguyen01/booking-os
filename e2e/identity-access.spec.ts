import { expect, test } from "@playwright/test";

const CONSOLE_BASE_URL = "http://localhost:3002";
const IDENTITY_TOKEN = "browser-acceptance-selector.browser-acceptance-verifier";
const EMAIL = "identity-access-missing-user@example.test";
const PASSWORD = "not-a-real-password";

async function expectIdentityTokenScrubbed(page: import("@playwright/test").Page): Promise<void> {
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(page.url()).not.toContain(IDENTITY_TOKEN);
  await expect(page.locator("body")).not.toContainText(IDENTITY_TOKEN);
}

test("identity-access browser acceptance scrubs tokens and does not mint a failed-login session", async ({
  context,
  page,
}) => {
  await page.goto(`${CONSOLE_BASE_URL}/activate#token=${encodeURIComponent(IDENTITY_TOKEN)}`);

  await expect(page.getByRole("heading", { name: "Activate your account" })).toBeVisible();
  await expectIdentityTokenScrubbed(page);

  await page.goto(`${CONSOLE_BASE_URL}/login`);
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);

  const responsePromise = page.waitForResponse(
    (response) => response.url() === `${CONSOLE_BASE_URL}/api/auth/login`,
  );
  await page.getByRole("button", { name: "Sign in" }).click();

  expect((await responsePromise).status()).toBe(401);
  const cookies = await context.cookies(CONSOLE_BASE_URL);
  expect(cookies.some((cookie) => cookie.name === "__Host-booking_session")).toBe(false);
  await expect(page.locator("body")).not.toContainText(PASSWORD);
  await expect(page.locator("body")).not.toContainText(IDENTITY_TOKEN);
});
