import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORIZATION_PERMISSION_KEYS,
  AUTHORIZATION_ROLE_KEYS,
  type AuthorizationContext,
} from "../src/auth/index.js";

test("authorization catalogs expose the approved stable identifiers", () => {
  assert.deepEqual(AUTHORIZATION_ROLE_KEYS, ["platform_admin", "tenant_owner", "tenant_admin"]);
  assert.deepEqual(AUTHORIZATION_PERMISSION_KEYS, [
    "platform.security.audit.read",
    "platform.security.session.revoke",
    "platform.tenants.provision",
    "platform.users.provision",
    "tenant.membership.read",
    "tenant.membership.admin.invite",
    "tenant.membership.admin.suspend",
    "tenant.membership.admin.revoke",
    "tenant.membership.owner.promote",
    "tenant.membership.owner.demote",
    "tenant.security.session.read",
    "tenant.security.session.revoke",
    "tenant.rbac.permission.read",
    "tenant.rbac.role.read",
    "tenant.rbac.role.create",
    "tenant.rbac.role.update",
    "tenant.rbac.role.archive",
    "tenant.rbac.role.permission.grant",
    "tenant.rbac.role.permission.revoke",
    "tenant.rbac.assignment.read",
    "tenant.rbac.assignment.grant",
    "tenant.rbac.assignment.revoke",
  ]);
});

test("platform authorization context exposes only current platform authority", () => {
  const context: AuthorizationContext = {
    userId: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    scope: { type: "platform" },
    roleKeys: ["platform_admin"],
    permissionKeys: ["platform.tenants.provision"],
    userAuthorizationVersion: 1,
  };

  assert.equal(context.scope.type, "platform");
  assert.equal(context.membershipId, undefined);
  assert.equal(context.membershipAuthorizationVersion, undefined);
});

test("tenant authorization context carries active membership authority", () => {
  const context: AuthorizationContext = {
    userId: "00000000-0000-4000-8000-000000000011",
    sessionId: "00000000-0000-4000-8000-000000000012",
    scope: {
      type: "tenant",
      tenantId: "00000000-0000-4000-8000-000000000013",
      tenantSlug: "acme",
    },
    membershipId: "00000000-0000-4000-8000-000000000014",
    membershipStatus: "active",
    roleKeys: ["tenant_owner"],
    permissionKeys: ["tenant.membership.read", "tenant.rbac.role.read"],
    userAuthorizationVersion: 2,
    membershipAuthorizationVersion: 3,
  };

  assert.deepEqual(context.scope, {
    type: "tenant",
    tenantId: "00000000-0000-4000-8000-000000000013",
    tenantSlug: "acme",
  });
  assert.equal(context.membershipStatus, "active");
  assert.equal(context.membershipAuthorizationVersion, 3);
});
