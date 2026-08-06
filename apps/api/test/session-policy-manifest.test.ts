import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_POLICY_MANIFEST } from "../src/modules/tenancy/infrastructure/persistence/tenant-policy-manifest.js";

test("session persistence tables are declared as nullable mixed-scope tenant tables", () => {
  const sessionPolicies = TENANT_POLICY_MANIFEST.filter((policy) =>
    ["auth_sessions", "auth_session_tokens"].includes(policy.table),
  );

  assert.deepEqual(sessionPolicies, [
    {
      table: "auth_sessions",
      tenantColumn: "tenant_id",
      tenantColumnNullable: true,
      applicationRole: "booking_app",
    },
    {
      table: "auth_session_tokens",
      tenantColumn: "tenant_id",
      tenantColumnNullable: true,
      applicationRole: "booking_app",
    },
  ]);
});
