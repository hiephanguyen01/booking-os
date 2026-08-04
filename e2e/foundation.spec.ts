import { expect, test } from "@playwright/test";

const API_BASE_URL = "http://127.0.0.1:3001/api";
const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";

test("storefront, console, readiness, and tenant isolation are reachable", async ({
  page,
  request,
}) => {
  await page.goto("http://127.0.0.1:3000");
  await expect(page.getByText("Booking OS", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading").first()).toBeVisible();

  await page.goto("http://127.0.0.1:3002");
  await expect(page.getByText("Booking OS", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading").first()).toBeVisible();

  const health = await request.get(`${API_BASE_URL}/health`);
  expect(health.ok()).toBeTruthy();

  const ready = await request.get(`${API_BASE_URL}/ready`);
  expect(ready.ok()).toBeTruthy();

  const tenantProbe = await request.get(`${API_BASE_URL}/foundation/tenant-probes`, {
    headers: {
      authorization: "Bearer foundation-probe",
      host: "tenant-a.localhost:3001",
    },
  });

  expect(tenantProbe.ok()).toBeTruthy();
  expect(await tenantProbe.json()).toEqual([
    expect.objectContaining({
      tenantId: TENANT_A_ID,
      value: "seed-a",
    }),
  ]);
});
