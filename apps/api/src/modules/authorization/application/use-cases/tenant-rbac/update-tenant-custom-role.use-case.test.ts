import assert from "node:assert/strict";
import test from "node:test";

import {
  TenantCustomRoleVersionConflictError,
  TenantRbacError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { UpdateTenantCustomRoleUseCase } from "./update-tenant-custom-role.use-case.js";
import {
  adminAuthorization,
  customRole,
  NOW,
  ownerAuthorization,
  RecordingTenantTransactions,
  ROLE_ID,
  USER_ID,
} from "./tenant-rbac-use-case.test-fixtures.js";

function updateHarness(current = customRole()) {
  const events: string[] = [];
  const transactions = new RecordingTenantTransactions({
    customRoles: {
      async lockById() {
        events.push("lock");
        return current;
      },
      async updateMetadata(input: { readonly name: string; readonly normalizedName: string }) {
        events.push(`update:${input.normalizedName}`);
        return customRole({
          ...current,
          name: input.name,
          normalizedName: input.normalizedName,
          description: "Updated description",
          version: current.version + 1,
        });
      },
    } as never,
    audit: {
      async append(input: { readonly eventType: string; readonly actorUserId: string | null }) {
        events.push(`audit:${input.eventType}:${input.actorUserId}`);
      },
    } as never,
  });
  return { events, transactions };
}

test("metadata update requires the expected role version and stale requests change nothing", async () => {
  const { events, transactions } = updateHarness(customRole({ version: 4 }));
  const useCase = new UpdateTenantCustomRoleUseCase(transactions);

  await assert.rejects(
    useCase.execute({
      authorization: ownerAuthorization(),
      roleId: ROLE_ID,
      name: "Dispatcher",
      description: "Updated description",
      expectedVersion: 3,
      requestId: "req-stale",
      now: NOW,
    }),
    TenantCustomRoleVersionConflictError,
  );
  assert.deepEqual(events, ["lock"]);
});

test("metadata no-op does not update, audit, or bump authority", async () => {
  const current = customRole();
  const { events, transactions } = updateHarness(current);
  const useCase = new UpdateTenantCustomRoleUseCase(transactions);

  const result = await useCase.execute({
    authorization: ownerAuthorization(),
    roleId: ROLE_ID,
    name: "  Dispatcher  ",
    description: current.description,
    expectedVersion: current.version,
    requestId: "req-noop",
    now: NOW,
  });

  assert.deepEqual(result, current);
  assert.deepEqual(events, ["lock"]);
});

test("persisted metadata change increments role version once and audits inside the transaction", async () => {
  const { events, transactions } = updateHarness();
  const useCase = new UpdateTenantCustomRoleUseCase(transactions);

  const updated = await useCase.execute({
    authorization: ownerAuthorization(),
    roleId: ROLE_ID,
    name: "Dispatch Team",
    description: "Updated description",
    expectedVersion: 3,
    requestId: "req-update",
    now: NOW,
  });

  assert.equal(updated.version, 4);
  assert.deepEqual(events, [
    "lock",
    "update:dispatch team",
    `audit:tenant.rbac.role.updated:${USER_ID}`,
  ]);
});

test("tenant admin cannot update tenant custom roles", async () => {
  const { events, transactions } = updateHarness();
  const useCase = new UpdateTenantCustomRoleUseCase(transactions);

  await assert.rejects(
    useCase.execute({
      authorization: adminAuthorization(),
      roleId: ROLE_ID,
      name: "Dispatch Team",
      description: null,
      expectedVersion: 3,
      requestId: "req-admin-update",
      now: NOW,
    }),
    TenantRbacError,
  );
  assert.deepEqual(events, []);
  assert.equal(transactions.contexts.length, 0);
});
