import assert from "node:assert/strict";
import test from "node:test";

import * as auth from "../src/index.js";

interface PermissionCatalogEntry {
  readonly key: string;
  readonly scopeLevel: "platform" | "tenant";
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
