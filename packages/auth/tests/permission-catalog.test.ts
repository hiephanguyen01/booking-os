import assert from "node:assert/strict";
import test from "node:test";

import * as auth from "../src/index.js";

interface PermissionCatalogEntry {
  readonly key: string;
  readonly scopeLevel: "platform" | "tenant" | "partner";
  readonly delegable: boolean;
  readonly description: string;
}

type PermissionCatalogModule = typeof auth & {
  readonly getPermissionCatalogEntry?: (key: string) => PermissionCatalogEntry | null;
  readonly isDelegableTenantPermission?: (key: string) => boolean;
};

const catalog = auth as PermissionCatalogModule;

test("permission catalog exposes code-owned metadata for Sprint 2 RBAC permissions", () => {
  assert.equal(typeof catalog.getPermissionCatalogEntry, "function");
  assert.equal(typeof catalog.isDelegableTenantPermission, "function");

  assert.deepEqual(catalog.getPermissionCatalogEntry?.("tenant.rbac.role.create"), {
    key: "tenant.rbac.role.create",
    scopeLevel: "tenant",
    delegable: false,
    description: "Create tenant custom roles.",
  });
  assert.deepEqual(catalog.getPermissionCatalogEntry?.("tenant.rbac.role.read"), {
    key: "tenant.rbac.role.read",
    scopeLevel: "tenant",
    delegable: true,
    description: "Read tenant custom roles.",
  });
  assert.equal(catalog.getPermissionCatalogEntry?.("not.real"), null);
});

test("RBAC mutations and owner lifecycle permissions are non-delegable", () => {
  const nonDelegable = [
    "tenant.rbac.role.create",
    "tenant.rbac.role.update",
    "tenant.rbac.role.archive",
    "tenant.rbac.role.permission.grant",
    "tenant.rbac.role.permission.revoke",
    "tenant.rbac.assignment.grant",
    "tenant.rbac.assignment.revoke",
    "tenant.membership.owner.promote",
    "tenant.membership.owner.demote",
  ] as const;

  for (const key of nonDelegable) {
    assert.equal(catalog.getPermissionCatalogEntry?.(key)?.delegable, false, key);
  }

  assert.equal(catalog.isDelegableTenantPermission?.("tenant.rbac.role.read"), true);
  assert.equal(catalog.isDelegableTenantPermission?.("platform.tenants.provision"), false);
});

test("Sprint 3 Partner permissions expose exact scope and delegability metadata", () => {
  const partnerScoped = [
    "partner.profile.read",
    "partner.profile.update",
    "partner.application.read",
    "partner.application.submit",
    "partner.verification.read",
    "partner.verification.update",
    "partner.payout_account.read",
    "partner.payout_account.update",
    "partner.review_finding.read",
  ] as const;

  for (const key of partnerScoped) {
    assert.equal(catalog.getPermissionCatalogEntry?.(key)?.scopeLevel, "partner", key);
    assert.equal(catalog.getPermissionCatalogEntry?.(key)?.delegable, false, key);
  }

  const tenantDelegable = [
    "tenant.partner.read",
    "tenant.partner.verification.read",
    "tenant.partner.payout_account.read",
    "tenant.partner.application.review",
    "tenant.partner.application.approve",
    "tenant.partner.application.reject",
  ] as const;

  for (const key of tenantDelegable) {
    assert.equal(catalog.getPermissionCatalogEntry?.(key)?.scopeLevel, "tenant", key);
    assert.equal(catalog.getPermissionCatalogEntry?.(key)?.delegable, true, key);
    assert.equal(catalog.isDelegableTenantPermission?.(key), true, key);
  }

  const tenantOwnerGoverned = [
    "tenant.partner.lifecycle.suspend",
    "tenant.partner.lifecycle.reactivate",
    "tenant.partner.lifecycle.cancel",
  ] as const;

  for (const key of tenantOwnerGoverned) {
    assert.equal(catalog.getPermissionCatalogEntry?.(key)?.scopeLevel, "tenant", key);
    assert.equal(catalog.getPermissionCatalogEntry?.(key)?.delegable, false, key);
    assert.equal(catalog.isDelegableTenantPermission?.(key), false, key);
  }
});
