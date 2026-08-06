import { expect, test } from "@playwright/test";

const CONSOLE_BASE_URL = "http://localhost:3002";
const EMAIL = "missing-session-user@example.test";
const PASSWORD = "not-a-real-password";

test("login reaches the API through the same-origin BFF with the trusted browser host", async ({
  context,
  page,
}) => {
  await page.goto(`${CONSOLE_BASE_URL}/login?returnTo=%2Fsecurity%2Fsessions`);

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);

  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url() === `${CONSOLE_BASE_URL}/api/auth/login`,
  );
  const responsePromise = page.waitForResponse(
    (response) => response.url() === `${CONSOLE_BASE_URL}/api/auth/login`,
  );

  await page.getByRole("button", { name: "Sign in" }).click();

  const request = await requestPromise;
  const response = await responsePromise;
  expect(request.postDataJSON()).toEqual({ email: EMAIL, password: PASSWORD });
  expect(response.status()).toBe(401);
  await expect(page.getByRole("alert")).toContainText(
    "We couldn't sign you in. Check your details and try again.",
  );

  const cookies = await context.cookies(CONSOLE_BASE_URL);
  expect(cookies.some((cookie) => cookie.name === "__Host-booking_session")).toBe(false);
  await expect(page.locator("body")).not.toContainText(PASSWORD);
});
