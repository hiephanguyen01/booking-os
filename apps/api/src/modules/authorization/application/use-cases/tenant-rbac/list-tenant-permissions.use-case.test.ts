import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";

import { ListTenantPermissionsUseCase } from "./list-tenant-permissions.use-case.js";
import {
  adminAuthorization,
  RecordingTenantTransactions,
  TENANT_ID,
} from "./tenant-rbac-use-case.test-fixtures.js";

test("tenant admin lists the deterministic tenant permission catalog in the trusted tenant scope", async () => {
  const transactions = new RecordingTenantTransactions({});
  const useCase = new ListTenantPermissionsUseCase(transactions);

  const permissions = await useCase.execute({ authorization: adminAuthorization() });

  assert.ok(permissions.length > 0);
  assert.ok(permissions.every((permission) => permission.scopeLevel === "tenant"));
  assert.deepEqual(
    permissions.map((permission) => permission.key),
    [...permissions.map((permission) => permission.key)].sort(),
  );
  assert.ok(
    permissions.some(
      (permission) =>
        permission.key === PERMISSION_KEYS.tenantRbacRoleCreate && !permission.delegable,
    ),
  );
  assert.equal(transactions.contexts[0]?.tenantId, TENANT_ID);
});
