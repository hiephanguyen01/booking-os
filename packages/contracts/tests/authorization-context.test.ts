import assert from "node:assert/strict";
import test from "node:test";

import {
  type ActivePartnerAuthorizationContext,
  AUTHORIZATION_PERMISSION_KEYS,
  AUTHORIZATION_ROLE_KEYS,
  type AuthorizationContext,
} from "../src/auth/index.js";

test("authorization catalogs expose the approved stable identifiers", () => {
  assert.deepEqual(AUTHORIZATION_ROLE_KEYS, [
    "platform_admin",
    "tenant_owner",
    "tenant_admin",
    "partner_owner",
    "partner_member",
  ]);
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
    "tenant.partner.read",
    "tenant.partner.review",
    "tenant.partner.approve",
    "tenant.partner.suspend",
    "partner.profile.read",
    "partner.profile.update",
    "partner.membership.read",
    "partner.membership.invite",
    "partner.membership.revoke",
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

test("Partner authorization context carries trusted Partner membership authority", () => {
  const context: ActivePartnerAuthorizationContext = {
    userId: "00000000-0000-4000-8000-000000000021",
    sessionId: "00000000-0000-4000-8000-000000000022",
    scope: {
      type: "partner",
      tenantId: "00000000-0000-4000-8000-000000000023",
      tenantSlug: "acme",
      partnerId: "00000000-0000-4000-8000-000000000024",
    },
    membershipId: "00000000-0000-4000-8000-000000000025",
    membershipStatus: "active",
    roleKeys: ["partner_owner"],
    permissionKeys: ["partner.profile.read", "partner.membership.invite"],
    userAuthorizationVersion: 4,
    membershipAuthorizationVersion: 5,
  };

  assert.deepEqual(context.scope, {
    type: "partner",
    tenantId: "00000000-0000-4000-8000-000000000023",
    tenantSlug: "acme",
    partnerId: "00000000-0000-4000-8000-000000000024",
  });
  assert.equal(context.membershipStatus, "active");
  assert.equal(context.membershipAuthorizationVersion, 5);
});
