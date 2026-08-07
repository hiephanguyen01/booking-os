import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationContext } from "../src/auth/index.js";

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
    permissionKeys: ["tenant.membership.read", "tenant.membership.owner.promote"],
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
