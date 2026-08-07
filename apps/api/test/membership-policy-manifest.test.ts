import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_POLICY_MANIFEST } from "../src/modules/tenancy/infrastructure/persistence/tenant-policy-manifest.js";

test("membership persistence is declared in the tenant policy manifest", () => {
  const membershipPolicies = TENANT_POLICY_MANIFEST.filter((policy) =>
    ["tenant_memberships", "membership_invitations", "role_assignments"].includes(policy.table),
  );

  assert.deepEqual(membershipPolicies, [
    {
      table: "tenant_memberships",
      tenantColumn: "tenant_id",
      tenantColumnNullable: false,
      applicationRole: "booking_app",
    },
    {
      table: "membership_invitations",
      tenantColumn: "tenant_id",
      tenantColumnNullable: false,
      applicationRole: "booking_app",
    },
    {
      table: "role_assignments",
      tenantColumn: "tenant_id",
      tenantColumnNullable: true,
      applicationRole: "booking_app",
    },
  ]);
});
