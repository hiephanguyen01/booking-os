import { expect, test } from "@playwright/test";

const CONSOLE_BASE_URL = "http://localhost:3002";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const ADMIN_MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const INVITATION_TOKEN = `${"a".repeat(22)}.${"b".repeat(43)}`;

function activeTenantSession(actorId = OWNER_ID) {
  return {
    actor: { id: actorId },
    session: {
      id: "66666666-6666-4666-8666-666666666666",
      state: "active",
      scope: { type: "tenant", tenantId: TENANT_ID },
    },
  };
}

const members = [
  {
    id: OWNER_MEMBERSHIP_ID,
    userId: OWNER_ID,
    status: "active",
    authorizationVersion: 3,
    roleKeys: ["tenant_owner"],
  },
  {
    id: ADMIN_MEMBERSHIP_ID,
    userId: ADMIN_ID,
    status: "active",
    authorizationVersion: 2,
    roleKeys: ["tenant_admin"],
  },
];

test("invited user consumes a fragment-only token and lands in active tenant context", async ({
  page,
}) => {
  await page.route(`${CONSOLE_BASE_URL}/api/invitations/*/accept`, async (route) => {
    expect(route.request().url()).toContain(encodeURIComponent(INVITATION_TOKEN));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"accepted":true}',
    });
  });
  await page.route(`${CONSOLE_BASE_URL}/api/auth/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(activeTenantSession()),
    });
  });
  await page.route(`${CONSOLE_BASE_URL}/api/tenants/${TENANT_ID}/members`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(members),
    });
  });

  await page.goto(
    `${CONSOLE_BASE_URL}/invite/accept#token=${encodeURIComponent(INVITATION_TOKEN)}`,
  );
  await expect(page.getByRole("heading", { name: "Accept tenant invitation" })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(page.url()).not.toContain(INVITATION_TOKEN);

  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(`${CONSOLE_BASE_URL}/settings/members`);
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
});

test("tenant owner invites an administrator, inspects state, and suspends the member", async ({
  page,
}) => {
  let invitationCommand: unknown;
  let suspended = false;

  await page.route(`${CONSOLE_BASE_URL}/api/auth/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(activeTenantSession()),
    });
  });
  await page.route(`${CONSOLE_BASE_URL}/api/tenants/${TENANT_ID}/members`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(members),
    });
  });
  await page.route(`${CONSOLE_BASE_URL}/api/tenants/${TENANT_ID}/invitations`, async (route) => {
    invitationCommand = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: '{"accepted":true}',
    });
  });
  await page.route(
    `${CONSOLE_BASE_URL}/api/tenants/${TENANT_ID}/members/${ADMIN_MEMBERSHIP_ID}/suspend`,
    async (route) => {
      suspended = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          membershipId: ADMIN_MEMBERSHIP_ID,
          status: "suspended",
          authorizationVersion: 3,
          revokedSessionCount: 1,
        }),
      });
    },
  );

  await page.goto(`${CONSOLE_BASE_URL}/settings/members`);
  await expect(page.getByText(ADMIN_ID, { exact: true })).toBeVisible();
  await expect(page.getByText("Administrator", { exact: true })).toBeVisible();
  await page.getByLabel("Administrator email").fill("new-admin@example.test");
  await expect(page.getByLabel("Role")).toHaveValue("tenant_admin");
  await expect(page.getByLabel("Expires in days")).toHaveValue("7");
  await page.getByRole("button", { name: "Invite administrator" }).click();

  expect(invitationCommand).toEqual({
    email: "new-admin@example.test",
    role: "tenant_admin",
    expires_in_days: 7,
  });
  await expect(page.getByText("Invitation queued for delivery.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect.poll(() => suspended).toBe(true);
});

test("tenant administrator UI does not expose owner-role mutations", async ({ page }) => {
  await page.route(`${CONSOLE_BASE_URL}/api/auth/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(activeTenantSession(ADMIN_ID)),
    });
  });
  await page.route(`${CONSOLE_BASE_URL}/api/tenants/${TENANT_ID}/members`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(members),
    });
  });

  await page.goto(`${CONSOLE_BASE_URL}/settings/members`);
  await expect(page.getByRole("button", { name: "Promote owner" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Demote owner" })).toHaveCount(0);
});
