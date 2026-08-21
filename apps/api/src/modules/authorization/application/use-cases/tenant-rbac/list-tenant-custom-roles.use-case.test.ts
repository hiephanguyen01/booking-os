import assert from "node:assert/strict";
import test from "node:test";

import { ListTenantCustomRolesUseCase } from "./list-tenant-custom-roles.use-case.js";
import {
  adminAuthorization,
  customRole,
  RecordingTenantTransactions,
  TENANT_ID,
} from "./tenant-rbac-use-case.test-fixtures.js";

test("tenant admin lists custom roles through an authorized tenant transaction", async () => {
  const expected = [customRole()];
  const transactions = new RecordingTenantTransactions({
    customRoles: {
      async list() {
        return expected;
      },
    } as never,
  });
  const useCase = new ListTenantCustomRolesUseCase(transactions);
  const authorization = adminAuthorization();

  const roles = await useCase.execute({ authorization });

  assert.deepEqual(roles, expected);
  assert.deepEqual(transactions.contexts[0], {
    tenantId: TENANT_ID,
    actorId: authorization.userId,
    sessionId: authorization.sessionId,
    authorization,
    requestId: authorization.sessionId,
    traceId: authorization.sessionId,
    source: "console",
  });
});
