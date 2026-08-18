import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";

import { PrismaTenantAuthorizationQueryAdapter } from "./prisma-tenant-authorization-query.adapter.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000001";

test("loads custom-role permission contributions without widening system roleKeys", async () => {
  let statement = "";
  let values: readonly unknown[] = [];
  const adapter = new PrismaTenantAuthorizationQueryAdapter(
    {
      async $queryRawUnsafe(sql: string, ...parameters: unknown[]) {
        statement = sql;
        values = parameters;
        return [
          {
            tenantSlug: "acme",
            membershipId: "40000000-0000-4000-8000-000000000001",
            membershipAuthorizationVersion: 7,
            roleKeys: ["tenant_admin"],
            permissionKeys: [
              PERMISSION_KEYS.tenantMembershipRead,
              PERMISSION_KEYS.tenantMembershipAdminInvite,
              PERMISSION_KEYS.tenantMembershipRead,
            ],
          },
        ];
      },
      async $executeRawUnsafe() {
        return 0;
      },
    },
    TENANT_ID,
  );

  const result = await adapter.loadActiveTenantAuthorization(USER_ID);

  assert.deepEqual(values, [TENANT_ID, USER_ID]);
  assert.deepEqual(result, {
    tenantSlug: "acme",
    membershipId: "40000000-0000-4000-8000-000000000001",
    membershipStatus: "active",
    membershipAuthorizationVersion: 7,
    roleKeys: ["tenant_admin"],
    permissionKeys: [
      PERMISSION_KEYS.tenantMembershipAdminInvite,
      PERMISSION_KEYS.tenantMembershipRead,
    ],
  });
  assert.match(statement, /tenant_custom_role_assignments/u);
  assert.match(statement, /tenant_custom_roles/u);
  assert.match(statement, /tenant_custom_role_permissions/u);
  assert.match(statement, /custom_assignment\."revoked_at" IS NULL/u);
  assert.match(statement, /custom_role\."archived_at" IS NULL/u);
  assert.match(statement, /custom_permission\."scope_level" = 'tenant'::role_scope_level/u);
});

test("fails closed for unknown permission or custom role identifiers returned by persistence", async () => {
  const makeAdapter = (roleKeys: readonly string[], permissionKeys: readonly string[]) =>
    new PrismaTenantAuthorizationQueryAdapter(
      {
        async $queryRawUnsafe() {
          return [
            {
              tenantSlug: "acme",
              membershipId: "40000000-0000-4000-8000-000000000001",
              membershipAuthorizationVersion: 7,
              roleKeys,
              permissionKeys,
            },
          ];
        },
        async $executeRawUnsafe() {
          return 0;
        },
      },
      TENANT_ID,
    );

  assert.equal(
    await makeAdapter(["tenant_admin"], ["tenant.unknown.permission"]).loadActiveTenantAuthorization(
      USER_ID,
    ),
    null,
  );
  assert.equal(
    await makeAdapter(
      ["tenant_admin", "custom_dispatcher"],
      [PERMISSION_KEYS.tenantMembershipRead],
    ).loadActiveTenantAuthorization(USER_ID),
    null,
  );
});
