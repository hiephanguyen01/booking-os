import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "@nestjs/common";

import { parseCreateTenantCustomRoleRequest } from "./tenant-rbac.dto.js";

test("keeps Partner management permissions out of Tenant RBAC HTTP until Partner routes exist", () => {
  assert.throws(
    () =>
      parseCreateTenantCustomRoleRequest({
        name: "Partner reviewer",
        permissionKeys: ["tenant.partner.read"],
      }),
    BadRequestException,
  );
});

test("preserves existing Tenant RBAC HTTP permissions", () => {
  assert.deepEqual(
    parseCreateTenantCustomRoleRequest({
      name: "RBAC reader",
      permissionKeys: ["tenant.rbac.role.read"],
    }),
    {
      name: "RBAC reader",
      description: null,
      permissionKeys: ["tenant.rbac.role.read"],
    },
  );
});
