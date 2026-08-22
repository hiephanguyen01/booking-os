import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS, type PermissionKey } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantMembership } from "../../../../memberships/domain/tenant-membership.js";
import {
  TenantCustomRoleArchivedError,
  TenantCustomRoleVersionConflictError,
  TenantRbacError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { ReplaceTenantCustomRolePermissionsUseCase } from "./replace-tenant-custom-role-permissions.use-case.js";
import {
  adminAuthorization,
  customRole,
  NOW,
  ownerAuthorization,
  RecordingTenantTransactions,
  ROLE_ID,
  TENANT_ID,
  USER_ID,
} from "./tenant-rbac-use-case.test-fixtures.js";

const HOLDER_A = "550e8400-e29b-41d4-a716-446655440106";
const HOLDER_B = "550e8400-e29b-41d4-a716-446655440107";
const PERMISSION_ID_MEMBERSHIP_READ = "550e8400-e29b-41d4-a716-446655440108";
const PERMISSION_ID_SESSION_READ = "550e8400-e29b-41d4-a716-446655440109";

function task5OwnerAuthorization(
  extraPermissions: readonly PermissionKey[] = [],
): AuthorizationContext {
  const base = ownerAuthorization();
  return Object.freeze({
    ...base,
    permissionKeys: Object.freeze([
      ...new Set([
        ...base.permissionKeys,
        PERMISSION_KEYS.tenantRbacRolePermissionGrant,
        PERMISSION_KEYS.tenantRbacRolePermissionRevoke,
        PERMISSION_KEYS.tenantRbacRoleArchive,
        ...extraPermissions,
      ]),
    ]),
  });
}

function task5AdminAuthorization(): AuthorizationContext {
  const base = adminAuthorization();
  return Object.freeze({
    ...base,
    permissionKeys: Object.freeze([
      ...new Set([
        ...base.permissionKeys,
        PERMISSION_KEYS.tenantRbacRolePermissionGrant,
        PERMISSION_KEYS.tenantRbacRolePermissionRevoke,
      ]),
    ]),
  });
}

function activeMembership(id: string): TenantMembership {
  return Object.freeze({
    id,
    tenantId: TENANT_ID,
    userId: USER_ID,
    status: "active" as const,
    authorizationVersion: 7,
    acceptedAt: NOW,
    suspendedAt: null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function permissionIdFor(key: PermissionKey): string | null {
  if (key === PERMISSION_KEYS.tenantMembershipRead) return PERMISSION_ID_MEMBERSHIP_READ;
  if (key === PERMISSION_KEYS.tenantSecuritySessionRead) return PERMISSION_ID_SESSION_READ;
  return null;
}

function createHarness(
  options: {
    readonly current?: ReturnType<typeof customRole>;
    readonly holders?: readonly string[];
  } = {},
) {
  const current = options.current ?? customRole();
  const holders = options.holders ?? [HOLDER_B, HOLDER_A];
  const events: string[] = [];
  const audits: Array<{
    readonly eventType: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  }> = [];

  const transactions = new RecordingTenantTransactions({
    customRoles: {
      async lockById(roleId: string) {
        events.push(`role.lock:${roleId}`);
        return current;
      },
      async replacePermissions(roleId: string, permissionIds: readonly string[]) {
        events.push(`permissions.replace:${roleId}:${permissionIds.join(",")}`);
      },
      async updateMetadata(input: { readonly expectedVersion: number }) {
        events.push(`role.bump:${input.expectedVersion}`);
        return customRole({ ...current, version: current.version + 1 });
      },
      async listActiveHolderMembershipIds(roleId: string) {
        events.push(`holders:${roleId}`);
        return holders;
      },
    } as never,
    rbacPermissions: {
      async findTenantPermissionsByKeys(keys: readonly PermissionKey[]) {
        events.push(`permissions.lookup:${keys.join(",")}`);
        return keys.flatMap((key) => {
          const id = permissionIdFor(key);
          return id ? [{ id, key }] : [];
        });
      },
    } as never,
    memberships: {
      async lockById(membershipId: string) {
        events.push(`membership.lock:${membershipId}`);
        return activeMembership(membershipId);
      },
      async incrementAuthorizationVersion(membershipId: string) {
        events.push(`membership.bump:${membershipId}`);
        return 8;
      },
    } as never,
    audit: {
      async append(input: {
        readonly eventType: string;
        readonly metadata: Readonly<Record<string, unknown>>;
      }) {
        audits.push({ eventType: input.eventType, metadata: input.metadata });
        events.push(`audit:${input.eventType}`);
      },
    } as never,
  });

  return { audits, current, events, transactions };
}

test("changed permission set replaces mappings, bumps role once, and invalidates active holders in UUID order", async () => {
  const { audits, events, transactions } = createHarness();
  const useCase = new ReplaceTenantCustomRolePermissionsUseCase(transactions);

  const result = await useCase.execute({
    authorization: task5OwnerAuthorization([PERMISSION_KEYS.tenantSecuritySessionRead]),
    roleId: ROLE_ID,
    permissionKeys: [
      PERMISSION_KEYS.tenantSecuritySessionRead,
      PERMISSION_KEYS.tenantMembershipRead,
      PERMISSION_KEYS.tenantSecuritySessionRead,
    ],
    expectedVersion: 3,
    requestId: "req-replace-permissions",
    now: NOW,
  });

  assert.equal(result.version, 4);
  assert.deepEqual(result.permissionKeys, [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantSecuritySessionRead,
  ]);
  assert.deepEqual(events, [
    `role.lock:${ROLE_ID}`,
    `permissions.lookup:${PERMISSION_KEYS.tenantMembershipRead},${PERMISSION_KEYS.tenantSecuritySessionRead}`,
    `permissions.replace:${ROLE_ID}:${PERMISSION_ID_MEMBERSHIP_READ},${PERMISSION_ID_SESSION_READ}`,
    "role.bump:3",
    `holders:${ROLE_ID}`,
    `membership.lock:${HOLDER_A}`,
    `membership.bump:${HOLDER_A}`,
    `membership.lock:${HOLDER_B}`,
    `membership.bump:${HOLDER_B}`,
    "audit:tenant.rbac.role.permissions_changed",
  ]);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], {
    eventType: "tenant.rbac.role.permissions_changed",
    metadata: {
      roleId: ROLE_ID,
      previousRoleVersion: 3,
      roleVersion: 4,
      addedPermissionKeys: [PERMISSION_KEYS.tenantSecuritySessionRead],
      removedPermissionKeys: [],
    },
  });
});

test("unchanged desired permission set is a success no-op with no version or authority bump", async () => {
  const { current, events, transactions } = createHarness();
  const useCase = new ReplaceTenantCustomRolePermissionsUseCase(transactions);

  const result = await useCase.execute({
    authorization: task5OwnerAuthorization(),
    roleId: ROLE_ID,
    permissionKeys: [PERMISSION_KEYS.tenantMembershipRead, PERMISSION_KEYS.tenantMembershipRead],
    expectedVersion: current.version,
    requestId: "req-replace-noop",
    now: NOW,
  });

  assert.deepEqual(result, current);
  assert.deepEqual(events, [`role.lock:${ROLE_ID}`]);
});

test("stale role version and archived role reject before any mapping or membership mutation", async () => {
  const stale = createHarness({ current: customRole({ version: 4 }) });
  await assert.rejects(
    new ReplaceTenantCustomRolePermissionsUseCase(stale.transactions).execute({
      authorization: task5OwnerAuthorization(),
      roleId: ROLE_ID,
      permissionKeys: [],
      expectedVersion: 3,
      requestId: "req-stale",
      now: NOW,
    }),
    TenantCustomRoleVersionConflictError,
  );
  assert.deepEqual(stale.events, [`role.lock:${ROLE_ID}`]);

  const archived = createHarness({ current: customRole({ archivedAt: NOW }) });
  await assert.rejects(
    new ReplaceTenantCustomRolePermissionsUseCase(archived.transactions).execute({
      authorization: task5OwnerAuthorization(),
      roleId: ROLE_ID,
      permissionKeys: [],
      expectedVersion: 3,
      requestId: "req-archived",
      now: NOW,
    }),
    TenantCustomRoleArchivedError,
  );
  assert.deepEqual(archived.events, [`role.lock:${ROLE_ID}`]);
});

test("invalid added permissions fail atomically with stable grant-boundary errors", async () => {
  const cases: ReadonlyArray<readonly [PermissionKey, string]> = [
    ["not.real" as PermissionKey, "TENANT_RBAC_PERMISSION_UNKNOWN"],
    [PERMISSION_KEYS.platformSecurityAuditRead, "TENANT_RBAC_PERMISSION_SCOPE_INVALID"],
    [PERMISSION_KEYS.tenantRbacRoleCreate, "TENANT_RBAC_PERMISSION_NOT_DELEGABLE"],
    [PERMISSION_KEYS.tenantSecuritySessionRead, "TENANT_RBAC_PERMISSION_GRANT_NOT_ALLOWED"],
  ];

  for (const [permissionKey, errorCode] of cases) {
    const { events, transactions } = createHarness();
    await assert.rejects(
      new ReplaceTenantCustomRolePermissionsUseCase(transactions).execute({
        authorization: task5OwnerAuthorization(),
        roleId: ROLE_ID,
        permissionKeys: [PERMISSION_KEYS.tenantMembershipRead, permissionKey],
        expectedVersion: 3,
        requestId: `req-invalid-${errorCode}`,
        now: NOW,
      }),
      (error: unknown) => error instanceof TenantRbacError && error.code === errorCode,
    );
    assert.deepEqual(events, [`role.lock:${ROLE_ID}`]);
  }
});

test("permission removal remains allowed when owner no longer holds the removed permission", async () => {
  const current = customRole({ permissionKeys: [PERMISSION_KEYS.tenantSecuritySessionRead] });
  const { events, transactions } = createHarness({ current, holders: [] });
  const useCase = new ReplaceTenantCustomRolePermissionsUseCase(transactions);

  const result = await useCase.execute({
    authorization: task5OwnerAuthorization(),
    roleId: ROLE_ID,
    permissionKeys: [],
    expectedVersion: 3,
    requestId: "req-removal",
    now: NOW,
  });

  assert.equal(result.version, 4);
  assert.deepEqual(result.permissionKeys, []);
  assert.deepEqual(events, [
    `role.lock:${ROLE_ID}`,
    `permissions.replace:${ROLE_ID}:`,
    "role.bump:3",
    `holders:${ROLE_ID}`,
    "audit:tenant.rbac.role.permissions_changed",
  ]);
});

test("tenant admin cannot replace permissions even when mutation permissions are injected", async () => {
  const { events, transactions } = createHarness();
  await assert.rejects(
    new ReplaceTenantCustomRolePermissionsUseCase(transactions).execute({
      authorization: task5AdminAuthorization(),
      roleId: ROLE_ID,
      permissionKeys: [],
      expectedVersion: 3,
      requestId: "req-admin-replace",
      now: NOW,
    }),
    TenantRbacError,
  );
  assert.deepEqual(events, []);
  assert.equal(transactions.contexts.length, 0);
});
