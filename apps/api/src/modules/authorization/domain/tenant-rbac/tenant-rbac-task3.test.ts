import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";

import { PrismaTenantCustomRoleAssignmentRepositoryAdapter } from "../../infrastructure/persistence/prisma/prisma-tenant-custom-role-assignment-repository.adapter.js";
import { PrismaTenantCustomRoleRepositoryAdapter } from "../../infrastructure/persistence/prisma/prisma-tenant-custom-role-repository.adapter.js";
import { PrismaTenantRbacPermissionRepositoryAdapter } from "../../infrastructure/persistence/prisma/prisma-tenant-rbac-permission-repository.adapter.js";
import {
  normalizeTenantCustomRoleName,
  TENANT_CUSTOM_ROLE_NAME_MAX_LENGTH,
} from "./tenant-custom-role-name.js";
import { TenantRbacError } from "./tenant-rbac.errors.js";

const TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";
const ROLE_ID = "550e8400-e29b-41d4-a716-446655440002";
const MEMBERSHIP_ID = "550e8400-e29b-41d4-a716-446655440003";
const ASSIGNMENT_ID = "550e8400-e29b-41d4-a716-446655440004";
const PERMISSION_ID = "550e8400-e29b-41d4-a716-446655440005";
const NOW = new Date("2026-08-18T03:30:00.000Z");

interface RecordedQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class RecordingTransaction {
  readonly queries: RecordedQuery[] = [];
  readonly executions: RecordedQuery[] = [];
  readonly results: unknown[][] = [];

  async $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T> {
    this.queries.push({ sql, values });
    return (this.results.shift() ?? []) as T;
  }

  async $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number> {
    this.executions.push({ sql, values });
    return 1;
  }
}

test("custom-role names use NFKC, trim, whitespace collapse, and Unicode lowercase", () => {
  assert.deepEqual(normalizeTenantCustomRoleName("  Ｄｉｓｐａｔｃｈｅｒ\t TEAM  "), {
    name: "Dispatcher TEAM",
    normalizedName: "dispatcher team",
  });
});

test("custom-role names reject empty and over-bound values", () => {
  assert.throws(
    () => normalizeTenantCustomRoleName(" \t\n "),
    (error: unknown) =>
      error instanceof TenantRbacError && error.code === "TENANT_CUSTOM_ROLE_NAME_INVALID",
  );
  assert.throws(
    () => normalizeTenantCustomRoleName("x".repeat(TENANT_CUSTOM_ROLE_NAME_MAX_LENGTH + 1)),
    (error: unknown) =>
      error instanceof TenantRbacError && error.code === "TENANT_CUSTOM_ROLE_NAME_INVALID",
  );
});

test("custom-role repository is tenant-bound, maps archive state, sorts permissions, and locks rows", async () => {
  const transaction = new RecordingTransaction();
  transaction.results.push([
    {
      id: ROLE_ID,
      tenantId: TENANT_ID,
      name: "Dispatcher",
      normalizedName: "dispatcher",
      description: null,
      version: 3,
      archivedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);
  transaction.results.push([
    { key: PERMISSION_KEYS.tenantRbacRoleRead },
    { key: PERMISSION_KEYS.tenantMembershipRead },
  ]);
  transaction.results.push([
    {
      id: ROLE_ID,
      tenantId: TENANT_ID,
      name: "Dispatcher",
      normalizedName: "dispatcher",
      description: null,
      version: 3,
      archivedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);
  transaction.results.push([]);

  const repository = new PrismaTenantCustomRoleRepositoryAdapter(transaction as never, TENANT_ID);
  const listed = await repository.list();
  const locked = await repository.lockById(ROLE_ID);

  assert.equal(listed[0]?.archivedAt, NOW);
  assert.deepEqual(listed[0]?.permissionKeys, [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantRbacRoleRead,
  ]);
  assert.equal(locked?.id, ROLE_ID);
  assert.equal(transaction.queries[0]?.values[0], TENANT_ID);
  assert.equal(transaction.queries[2]?.values[0], TENANT_ID);
  assert.equal(transaction.queries[2]?.values[1], ROLE_ID);
  assert.match(transaction.queries[2]?.sql ?? "", /FOR UPDATE/i);
});

test("assignment repository never accepts tenant identity from the caller", async () => {
  const transaction = new RecordingTransaction();
  transaction.results.push([
    {
      id: ASSIGNMENT_ID,
      tenantId: TENANT_ID,
      membershipId: MEMBERSHIP_ID,
      roleId: ROLE_ID,
      createdAt: NOW,
      revokedAt: null,
    },
  ]);
  transaction.results.push([{ id: ASSIGNMENT_ID }]);

  const repository = new PrismaTenantCustomRoleAssignmentRepositoryAdapter(
    transaction as never,
    TENANT_ID,
  );
  const assignment = await repository.grant(MEMBERSHIP_ID, ROLE_ID, NOW);
  const revoked = await repository.revoke(MEMBERSHIP_ID, ROLE_ID, NOW);

  assert.equal(assignment.tenantId, TENANT_ID);
  assert.equal(revoked, true);
  for (const query of transaction.queries) {
    assert.equal(query.values[0], TENANT_ID);
  }
});

test("permission repository returns only deterministic tenant-scoped permission records", async () => {
  const transaction = new RecordingTransaction();
  transaction.results.push([
    { id: PERMISSION_ID, key: PERMISSION_KEYS.tenantRbacRoleRead },
    { id: "550e8400-e29b-41d4-a716-446655440006", key: PERMISSION_KEYS.tenantMembershipRead },
  ]);

  const repository = new PrismaTenantRbacPermissionRepositoryAdapter(transaction as never);
  const rows = await repository.findTenantPermissionsByKeys([
    PERMISSION_KEYS.tenantRbacRoleRead,
    PERMISSION_KEYS.tenantMembershipRead,
  ]);

  assert.deepEqual(
    rows.map((row) => row.key),
    [PERMISSION_KEYS.tenantMembershipRead, PERMISSION_KEYS.tenantRbacRoleRead],
  );
  assert.match(transaction.queries[0]?.sql ?? "", /scope_level[^\n]*tenant/i);
});
