import { expect, test } from "@playwright/test";

const CONSOLE_BASE_URL = "http://localhost:3002";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

test("platform admin bootstraps a tenant and inspects provisioning status", async ({ page }) => {
  let createCommand: unknown;
  let idempotencyKey: string | null = null;

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
