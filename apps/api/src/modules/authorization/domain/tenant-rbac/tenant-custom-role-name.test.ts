import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTenantCustomRoleName,
  TENANT_CUSTOM_ROLE_NAME_MAX_LENGTH,
} from "./tenant-custom-role-name.js";
import { TenantRbacError } from "./tenant-rbac.errors.js";

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
