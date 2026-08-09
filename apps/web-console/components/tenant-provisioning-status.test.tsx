import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { TenantProvisioningStatus } from "./tenant-provisioning-status.js";

it("renders the tenant name and slug from provisioning status", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      tenantId: "11111111-1111-4111-8111-111111111111",
      tenantName: "Acme Studio",
      slug: "acme-studio",
      status: "provisioning",
      ownerMembershipId: "22222222-2222-4222-8222-222222222222",
      ownerInvitationId: "33333333-3333-4333-8333-333333333333",
    }),
  );

  render(<TenantProvisioningStatus tenantId="11111111-1111-4111-8111-111111111111" />);

  expect(await screen.findByText("Acme Studio")).toBeTruthy();
  expect(screen.getByText("acme-studio")).toBeTruthy();
});
