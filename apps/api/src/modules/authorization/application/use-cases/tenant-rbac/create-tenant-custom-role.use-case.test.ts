import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";

import {
  TenantCustomRoleNameConflictError,
  TenantRbacError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { CreateTenantCustomRoleUseCase } from "./create-tenant-custom-role.use-case.js";
import {
  adminAuthorization,
  customRole,
  NOW,
  ownerAuthorization,
  RecordingTenantTransactions,
  ROLE_ID,
  USER_ID,
} from "./tenant-rbac-use-case.test-fixtures.js";

function createHarness(options: { readonly duplicateName?: boolean } = {}) {
  const events: string[] = [];
  const permissionId = "550e8400-e29b-41d4-a716-446655440106";
  const transactions = new RecordingTenantTransactions({
    rbacPermissions: {
      async findTenantPermissionsByKeys(keys: readonly string[]) {
        events.push(`permissions:${keys.join(",")}`);
        return [{ id: permissionId, key: PERMISSION_KEYS.tenantMembershipRead }];
      },
    } as never,
    customRoles: {
      async create(input: { readonly name: string; readonly normalizedName: string }) {
        events.push(`create:${input.normalizedName}`);
        if (options.duplicateName) throw new TenantCustomRoleNameConflictError();
        return customRole({
          id: ROLE_ID,
          name: input.name,
          normalizedName: input.normalizedName,
          version: 1,
          permissionKeys: [],
        });
      },
      async replacePermissions(roleId: string, permissionIds: readonly string[]) {
        events.push(`mappings:${roleId}:${permissionIds.join(",")}`);
      },
    } as never,
    audit: {
      async append(input: { readonly eventType: string; readonly actorUserId: string | null }) {
        events.push(`audit:${input.eventType}:${input.actorUserId}`);
      },
    } as never,
  });
  return { events, permissionId, transactions };
}

test("owner creates a normalized role with initial permissions and audit atomically", async () => {
  const { events, permissionId, transactions } = createHarness();
  const useCase = new CreateTenantCustomRoleUseCase(transactions);

  const created = await useCase.execute({
    authorization: ownerAuthorization(),
    name: "  Ｄｉｓｐａｔｃｈｅｒ   Team  ",
    description: "Dispatch desk",
    permissionKeys: [PERMISSION_KEYS.tenantMembershipRead],
    requestId: "req-create-role",
    now: NOW,
  });

  assert.equal(created.name, "Dispatcher Team");
  assert.equal(created.normalizedName, "dispatcher team");
  assert.deepEqual(events, [
    `permissions:${PERMISSION_KEYS.tenantMembershipRead}`,
    "create:dispatcher team",
    `mappings:${ROLE_ID}:${permissionId}`,
    `audit:tenant.rbac.role.created:${USER_ID}`,
  ]);
});

test("tenant admin cannot create roles and invalid initial authority commits nothing", async () => {
  const denied = createHarness();
  const useCase = new CreateTenantCustomRoleUseCase(denied.transactions);

  await assert.rejects(
    useCase.execute({
      authorization: adminAuthorization(),
      name: "Dispatcher",
      description: null,
      permissionKeys: [],
      requestId: "req-admin-create",
      now: NOW,
    }),
    TenantRbacError,
  );
  assert.deepEqual(denied.events, []);
  assert.equal(denied.transactions.contexts.length, 0);

  const invalid = createHarness();
  const invalidUseCase = new CreateTenantCustomRoleUseCase(invalid.transactions);
  await assert.rejects(
    invalidUseCase.execute({
      authorization: ownerAuthorization(),
      name: "Dispatcher",
      description: null,
      permissionKeys: [PERMISSION_KEYS.tenantRbacRoleCreate],
      requestId: "req-invalid-permission",
      now: NOW,
    }),
    (error: unknown) =>
      error instanceof TenantRbacError && error.code === "TENANT_RBAC_PERMISSION_NOT_DELEGABLE",
  );
  assert.deepEqual(invalid.events, []);
});

test("duplicate normalized role name preserves the stable conflict error", async () => {
  const { transactions } = createHarness({ duplicateName: true });
  const useCase = new CreateTenantCustomRoleUseCase(transactions);

  await assert.rejects(
    useCase.execute({
      authorization: ownerAuthorization(),
      name: "Dispatcher",
      description: null,
      permissionKeys: [],
      requestId: "req-duplicate",
      now: NOW,
    }),
    TenantCustomRoleNameConflictError,
  );
});
