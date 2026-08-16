import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_POLICY_MANIFEST } from "../src/modules/tenancy/infrastructure/persistence/tenant-policy-manifest.js";

test("tenant custom RBAC persistence is declared in the tenant policy manifest", () => {
  const rbacPolicies = TENANT_POLICY_MANIFEST.filter((policy) =>
    [
      "tenant_custom_roles",
      "tenant_custom_role_permissions",
      "tenant_custom_role_assignments",
    ].includes(policy.table),
  );

  assert.deepEqual(rbacPolicies, [
    {
      table: "tenant_custom_roles",
      tenantColumn: "tenant_id",
      tenantColumnNullable: false,
      applicationRole: "booking_app",
    },
    {
      table: "tenant_custom_role_permissions",
      tenantColumn: "tenant_id",
      tenantColumnNullable: false,
      applicationRole: "booking_app",
    },
    {
      table: "tenant_custom_role_assignments",
      tenantColumn: "tenant_id",
      tenantColumnNullable: false,
      applicationRole: "booking_app",
    },
  ]);
});
