import assert from "node:assert/strict";
import test from "node:test";

import { hasPermission, PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";

import { sampleTenantAdminSession } from "./sample-session.js";

test("sample console session uses the tenant administrator role", () => {
  assert.equal(sampleTenantAdminSession.user.id, "tenant-admin-demo");
  assert.equal(sampleTenantAdminSession.user.role, SYSTEM_ROLES.tenantAdmin);
});

test("sample tenant administrator can invite tenant administrators", () => {
  assert.equal(
    hasPermission(sampleTenantAdminSession.user.role, PERMISSION_KEYS.tenantMembershipAdminInvite),
    true,
  );
});

test("sample tenant administrator cannot promote owners", () => {
  assert.equal(
    hasPermission(sampleTenantAdminSession.user.role, PERMISSION_KEYS.tenantMembershipOwnerPromote),
    false,
  );
});
