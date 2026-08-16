import assert from "node:assert/strict";
import test from "node:test";

import { getPermissions, hasPermission, PERMISSION_KEYS, SYSTEM_ROLES } from "../src/index.js";

test("system role catalog contains only the approved immutable roles", () => {
  assert.deepEqual(SYSTEM_ROLES, {
    platformAdmin: "platform_admin",
    tenantOwner: "tenant_owner",
    tenantAdmin: "tenant_admin",
  });
  assert.equal("partner" in SYSTEM_ROLES, false);
  assert.equal("affiliate" in SYSTEM_ROLES, false);
});

test("permission catalog preserves Sprint 1B keys and appends only Sprint 2 RBAC keys", () => {
  assert.deepEqual(PERMISSION_KEYS, {
    platformSecurityAuditRead: "platform.security.audit.read",
    platformSecuritySessionRevoke: "platform.security.session.revoke",
    platformTenantsProvision: "platform.tenants.provision",
    platformUsersProvision: "platform.users.provision",
    tenantMembershipRead: "tenant.membership.read",
    tenantMembershipAdminInvite: "tenant.membership.admin.invite",
    tenantMembershipAdminSuspend: "tenant.membership.admin.suspend",
    tenantMembershipAdminRevoke: "tenant.membership.admin.revoke",
    tenantMembershipOwnerPromote: "tenant.membership.owner.promote",
    tenantMembershipOwnerDemote: "tenant.membership.owner.demote",
    tenantSecuritySessionRead: "tenant.security.session.read",
    tenantSecuritySessionRevoke: "tenant.security.session.revoke",
    tenantRbacPermissionRead: "tenant.rbac.permission.read",
    tenantRbacRoleRead: "tenant.rbac.role.read",
    tenantRbacRoleCreate: "tenant.rbac.role.create",
    tenantRbacRoleUpdate: "tenant.rbac.role.update",
    tenantRbacRoleArchive: "tenant.rbac.role.archive",
    tenantRbacRolePermissionGrant: "tenant.rbac.role.permission.grant",
    tenantRbacRolePermissionRevoke: "tenant.rbac.role.permission.revoke",
    tenantRbacAssignmentRead: "tenant.rbac.assignment.read",
    tenantRbacAssignmentGrant: "tenant.rbac.assignment.grant",
    tenantRbacAssignmentRevoke: "tenant.rbac.assignment.revoke",
  });
});

test("platform administrator receives only platform permissions", () => {
  assert.deepEqual(getPermissions(SYSTEM_ROLES.platformAdmin), [
    PERMISSION_KEYS.platformSecurityAuditRead,
    PERMISSION_KEYS.platformSecuritySessionRevoke,
    PERMISSION_KEYS.platformTenantsProvision,
    PERMISSION_KEYS.platformUsersProvision,
  ]);
});

test("tenant owner receives existing tenant permissions plus all Sprint 2 RBAC permissions", () => {
  assert.deepEqual(getPermissions(SYSTEM_ROLES.tenantOwner), [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantMembershipAdminInvite,
    PERMISSION_KEYS.tenantMembershipAdminSuspend,
    PERMISSION_KEYS.tenantMembershipAdminRevoke,
    PERMISSION_KEYS.tenantMembershipOwnerPromote,
    PERMISSION_KEYS.tenantMembershipOwnerDemote,
    PERMISSION_KEYS.tenantSecuritySessionRead,
    PERMISSION_KEYS.tenantSecuritySessionRevoke,
    PERMISSION_KEYS.tenantRbacPermissionRead,
    PERMISSION_KEYS.tenantRbacRoleRead,
    PERMISSION_KEYS.tenantRbacRoleCreate,
    PERMISSION_KEYS.tenantRbacRoleUpdate,
    PERMISSION_KEYS.tenantRbacRoleArchive,
    PERMISSION_KEYS.tenantRbacRolePermissionGrant,
    PERMISSION_KEYS.tenantRbacRolePermissionRevoke,
    PERMISSION_KEYS.tenantRbacAssignmentRead,
    PERMISSION_KEYS.tenantRbacAssignmentGrant,
    PERMISSION_KEYS.tenantRbacAssignmentRevoke,
  ]);
});

test("tenant administrator receives RBAC read permissions but no RBAC mutation permission", () => {
  assert.equal(
    hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantMembershipOwnerPromote),
    false,
  );
  assert.equal(
    hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantMembershipOwnerDemote),
    false,
  );
  assert.deepEqual(getPermissions(SYSTEM_ROLES.tenantAdmin), [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantMembershipAdminInvite,
    PERMISSION_KEYS.tenantMembershipAdminSuspend,
    PERMISSION_KEYS.tenantMembershipAdminRevoke,
    PERMISSION_KEYS.tenantSecuritySessionRead,
    PERMISSION_KEYS.tenantSecuritySessionRevoke,
    PERMISSION_KEYS.tenantRbacPermissionRead,
    PERMISSION_KEYS.tenantRbacRoleRead,
    PERMISSION_KEYS.tenantRbacAssignmentRead,
  ]);
  assert.equal(hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantRbacRoleCreate), false);
  assert.equal(
    hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantRbacAssignmentGrant),
    false,
  );
});

test("missing role has no permission", () => {
  assert.equal(hasPermission(undefined, PERMISSION_KEYS.tenantMembershipRead), false);
});

test("permission arrays are fresh values", () => {
  const first = getPermissions(SYSTEM_ROLES.tenantOwner);
  const second = getPermissions(SYSTEM_ROLES.tenantOwner);

  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});
