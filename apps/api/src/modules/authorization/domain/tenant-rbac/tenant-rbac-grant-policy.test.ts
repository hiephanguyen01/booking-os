import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";

interface TenantRbacGrantPolicyModule {
  readonly canMutateTenantRbac: (input: {
    readonly actorSystemRoles: readonly string[];
    readonly actorPermissionKeys: readonly string[];
  }) => boolean;
  readonly canAddTenantRolePermission: (
    input: {
      readonly actorSystemRoles: readonly string[];
      readonly actorPermissionKeys: readonly string[];
    },
    permission: string,
  ) => boolean;
}

async function loadPolicy(): Promise<TenantRbacGrantPolicyModule | null> {
  try {
    return (await import("./tenant-rbac-grant-policy.js")) as TenantRbacGrantPolicyModule;
  } catch (error: unknown) {
    if (error instanceof Error && /Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) return null;
    throw error;
  }
}

test("only an authoritative tenant owner can mutate tenant RBAC", async () => {
  const policy = await loadPolicy();
  assert.ok(policy, "tenant RBAC grant policy module must exist");

  assert.equal(
    policy.canMutateTenantRbac({
      actorSystemRoles: [SYSTEM_ROLES.tenantAdmin],
      actorPermissionKeys: [PERMISSION_KEYS.tenantRbacRoleCreate],
    }),
    false,
  );
  assert.equal(
    policy.canMutateTenantRbac({
      actorSystemRoles: [SYSTEM_ROLES.tenantOwner],
      actorPermissionKeys: [PERMISSION_KEYS.tenantRbacRoleCreate],
    }),
    true,
  );
});

test("owner can add only held tenant-scoped delegable permissions", async () => {
  const policy = await loadPolicy();
  assert.ok(policy, "tenant RBAC grant policy module must exist");

  const ownerContext = {
    actorSystemRoles: [SYSTEM_ROLES.tenantOwner],
    actorPermissionKeys: [
      PERMISSION_KEYS.tenantRbacRoleRead,
      PERMISSION_KEYS.tenantMembershipOwnerPromote,
      PERMISSION_KEYS.platformTenantsProvision,
    ],
  } as const;

  assert.equal(
    policy.canAddTenantRolePermission(ownerContext, PERMISSION_KEYS.tenantRbacRoleRead),
    true,
  );
  assert.equal(
    policy.canAddTenantRolePermission(ownerContext, PERMISSION_KEYS.tenantMembershipOwnerPromote),
    false,
  );
  assert.equal(
    policy.canAddTenantRolePermission(ownerContext, PERMISSION_KEYS.platformTenantsProvision),
    false,
  );
  assert.equal(
    policy.canAddTenantRolePermission(
      { ...ownerContext, actorPermissionKeys: [] },
      PERMISSION_KEYS.tenantRbacRoleRead,
    ),
    false,
  );
});
