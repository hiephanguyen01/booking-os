import assert from "node:assert/strict";
import test from "node:test";

import { TenantCustomRoleNotFoundError } from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { GetTenantCustomRoleUseCase } from "./get-tenant-custom-role.use-case.js";
import {
  adminAuthorization,
  RecordingTenantTransactions,
  ROLE_ID,
} from "./tenant-rbac-use-case.test-fixtures.js";

test("custom-role lookup fails closed when the current tenant session cannot see the role", async () => {
  const transactions = new RecordingTenantTransactions({
    customRoles: {
      async findById() {
        return null;
      },
    } as never,
  });
  const useCase = new GetTenantCustomRoleUseCase(transactions);

  await assert.rejects(
    useCase.execute({ authorization: adminAuthorization(), roleId: ROLE_ID }),
    TenantCustomRoleNotFoundError,
  );
});
