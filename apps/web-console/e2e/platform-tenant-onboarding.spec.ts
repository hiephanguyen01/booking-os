import { expect, test } from "@playwright/test";

import { installAuthenticatedSession } from "./authenticated-session.ts";

const CONSOLE_BASE_URL = "http://localhost:3002";
const TENANT_CONSOLE_BASE_URL = "http://tenant-a.booking.localhost:3002";
const PLATFORM_ADMIN_ID = "77777777-7777-4777-8777-777777777777";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVATION_TOKEN = `${"a".repeat(22)}.${"b".repeat(43)}`;
const INVITATION_TOKEN = `${"c".repeat(22)}.${"d".repeat(43)}`;
const OWNER_EMAIL = "owner@example.test";
const NEW_PASSWORD = "Long-enough-password-123!";

test("platform admin bootstraps a tenant and inspects provisioning status", async ({
  context,
  page,
}) => {
  let createCommand: unknown;
  let idempotencyKey: string | null = null;

  await installAuthenticatedSession(context, {
    origin: CONSOLE_BASE_URL,
    userId: PLATFORM_ADMIN_ID,
    hostname: "localhost",
    scope: { type: "platform" },
  });
  await page.route(`${CONSOLE_BASE_URL}/api/platform/tenants`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createCommand = route.request().postDataJSON();
    idempotencyKey = route.request().headers()["idempotency-key"] ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tenantId: TENANT_ID,
        slug: "acme-studio",
        status: "provisioning",
        ownerMembershipId: "22222222-2222-4222-8222-222222222222",
        ownerInvitationId: "33333333-3333-4333-8333-333333333333",
      }),
    });
  });
  await page.route(
    `${CONSOLE_BASE_URL}/api/platform/tenants/${TENANT_ID}/status`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tenantId: TENANT_ID,
          slug: "acme-studio",
          status: "provisioning",
          ownerMembershipId: "22222222-2222-4222-8222-222222222222",
          ownerInvitationId: "33333333-3333-4333-8333-333333333333",
        }),
      });
    },
  );

  await page.goto(`${CONSOLE_BASE_URL}/platform/create`);
  await page.getByLabel("Tenant slug").fill("acme-studio");
  await page.getByLabel("Tenant name").fill("Acme Studio");
  await page.getByLabel("Initial owner email").fill("owner@example.test");
  await page.getByRole("button", { name: "Create tenant" }).click();

  await expect(page).toHaveURL(`${CONSOLE_BASE_URL}/platform/status?tenantId=${TENANT_ID}`);
  expect(createCommand).toEqual({
    slug: "acme-studio",
    tenantName: "Acme Studio",
    ownerEmail: "owner@example.test",
  });
  expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(page.getByText("acme-studio", { exact: true })).toBeVisible();
  await expect(page.getByText("provisioning", { exact: true })).toBeVisible();
});

test("new owner activates, signs in normally, and explicitly accepts the invitation", async ({
  page,
}) => {
  const commands: string[] = [];
  let acceptRequests = 0;

  await page.route(`${TENANT_CONSOLE_BASE_URL}/api/auth/activation/complete`, async (route) => {
    commands.push("activation");
    expect(route.request().postDataJSON()).toEqual({
      token: ACTIVATION_TOKEN,
      newPassword: NEW_PASSWORD,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ completed: true, continuationEmail: OWNER_EMAIL }),
    });
  });
  await page.route(`${TENANT_CONSOLE_BASE_URL}/api/auth/login`, async (route) => {
    commands.push("login");
    expect(route.request().postDataJSON()).toEqual({
      email: OWNER_EMAIL,
      password: NEW_PASSWORD,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"authenticated":true}',
    });
  });
  await page.route(`${TENANT_CONSOLE_BASE_URL}/api/invitations/*/accept`, async (route) => {
    acceptRequests += 1;
    expect(route.request().url()).toContain(encodeURIComponent(INVITATION_TOKEN));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"accepted":true}',
    });
  });

  await page.goto(
    `${TENANT_CONSOLE_BASE_URL}/activate#activation=${encodeURIComponent(ACTIVATION_TOKEN)}&invitation=${encodeURIComponent(INVITATION_TOKEN)}`,
  );
  await expect(page.getByRole("heading", { name: "Activate your account" })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(page.url()).not.toContain(ACTIVATION_TOKEN);
  expect(page.url()).not.toContain(INVITATION_TOKEN);

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Activate account" }).click();

  await expect.poll(() => commands).toEqual(["activation", "login"]);
  await expect(page.getByRole("heading", { name: "Accept tenant invitation" })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(page.url()).not.toContain(INVITATION_TOKEN);
  expect(acceptRequests).toBe(0);

  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect.poll(() => acceptRequests).toBe(1);
});
