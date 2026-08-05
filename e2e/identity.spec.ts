import { expect, test } from "@playwright/test";

const CONSOLE_BASE_URL = "http://localhost:3002";
const IDENTITY_TOKEN = "browser-selector.browser-verifier";
const NEW_PASSWORD = "Long-enough-password-123!";

async function expectTokenRemovedFromBrowser(page: import("@playwright/test").Page): Promise<void> {
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(page.url()).not.toContain(IDENTITY_TOKEN);
  await expect(page.locator("body")).not.toContainText(IDENTITY_TOKEN);
}

test("activation removes the fragment and submits only the platform command to the BFF", async ({
  page,
}) => {
  await page.goto(`${CONSOLE_BASE_URL}/activate#token=${encodeURIComponent(IDENTITY_TOKEN)}`);

  await expect(page.getByRole("heading", { name: "Activate your account" })).toBeVisible();
  await expectTokenRemovedFromBrowser(page);

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);

  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url() === `${CONSOLE_BASE_URL}/api/auth/activation/complete`,
  );
  const responsePromise = page.waitForResponse(
    (response) => response.url() === `${CONSOLE_BASE_URL}/api/auth/activation/complete`,
  );

  await page.getByRole("button", { name: "Activate account" }).click();

  const request = await requestPromise;
  expect(request.postDataJSON()).toEqual({
    scopeType: "platform",
    token: IDENTITY_TOKEN,
    newPassword: NEW_PASSWORD,
  });
  expect((await responsePromise).status()).toBe(502);
  await expect(page.getByRole("alert")).toContainText("We couldn't activate your account");
  await expectTokenRemovedFromBrowser(page);
});

test("invalid activation values do not send a command", async ({ page }) => {
  await page.goto(`${CONSOLE_BASE_URL}/activate#token=${encodeURIComponent(IDENTITY_TOKEN)}`);
  let commands = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/activation/complete")) commands += 1;
  });

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("Different-password-123!");
  await page.getByRole("button", { name: "Activate account" }).click();

  await expect(page.getByRole("alert")).toContainText("The passwords do not match.");
  expect(commands).toBe(0);
});

test("forgot-password submits a neutral platform request through the BFF", async ({ page }) => {
  const email = "browser-forgot@example.test";
  await page.goto(`${CONSOLE_BASE_URL}/password/forgot`);

  await page.getByLabel("Email address").fill(email);

  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url() === `${CONSOLE_BASE_URL}/api/auth/password/forgot`,
  );
  const responsePromise = page.waitForResponse(
    (response) => response.url() === `${CONSOLE_BASE_URL}/api/auth/password/forgot`,
  );

  await page.getByRole("button", { name: "Send reset link" }).click();

  const request = await requestPromise;
  expect(request.postDataJSON()).toEqual({ scopeType: "platform", email });
  expect((await responsePromise).status()).toBe(202);
  await expect(page.getByRole("status")).toContainText(
    "If an account matches that email, a reset link will be sent.",
  );
});

test("identity shell supports keyboard entry", async ({ page }) => {
  await page.goto(`${CONSOLE_BASE_URL}/password/forgot`);

  await expect(page.locator("main")).toHaveClass(/min-h-screen/);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address")).toBeFocused();
});

test("password reset removes the fragment and submits only the platform command to the BFF", async ({
  page,
}) => {
  await page.goto(`${CONSOLE_BASE_URL}/password/reset#token=${encodeURIComponent(IDENTITY_TOKEN)}`);

  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expectTokenRemovedFromBrowser(page);

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);

  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url() === `${CONSOLE_BASE_URL}/api/auth/password/reset`,
  );
  const responsePromise = page.waitForResponse(
    (response) => response.url() === `${CONSOLE_BASE_URL}/api/auth/password/reset`,
  );

  await page.getByRole("button", { name: "Reset password" }).click();

  const request = await requestPromise;
  expect(request.postDataJSON()).toEqual({
    scopeType: "platform",
    token: IDENTITY_TOKEN,
    newPassword: NEW_PASSWORD,
  });
  expect((await responsePromise).status()).toBe(502);
  await expect(page.getByRole("alert")).toContainText("We couldn't reset your password");
  await expectTokenRemovedFromBrowser(page);
});
