import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const tenantId = randomUUID();
const userId = randomUUID();
const membershipId = randomUUID();

function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { value: String(error) };
  }

  const prismaError = error as Error & {
    code?: string;
    meta?: unknown;
  };

  return {
    name: error.name,
    message: error.message,
    code: prismaError.code,
    meta: prismaError.meta,
  };
}

async function runAsTenant<T>(
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return work(transaction);
  });
}

after(async () => {
  try {
    await prisma.$executeRaw`DELETE FROM "tenants" WHERE "id" = ${tenantId}::uuid`;
    await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}::uuid`;
  } finally {
    await prisma.$disconnect();
  }
});

test("diagnose tenant custom-RBAC grants and membership fixture", async () => {
  const expectedTables = [
    "tenant_custom_role_assignments",
    "tenant_custom_role_permissions",
    "tenant_custom_roles",
  ];

  const tableMetadata = await prisma.$queryRaw<
    readonly {
      table_name: string;
      owner: string;
      relacl: string | null;
      current_user: string;
      session_user: string;
    }[]
  >`
    SELECT c.relname AS table_name,
           c.relowner::regrole::text AS owner,
           c.relacl::text AS relacl,
           current_user::text AS current_user,
           session_user::text AS session_user
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(${expectedTables}::text[])
    ORDER BY c.relname
  `;

  const grants = await prisma.$queryRaw<
    readonly {
      table_name: string;
      grantor: string;
      grantee: string;
      privilege_type: string;
      is_grantable: string;
    }[]
  >`
    SELECT table_name, grantor, grantee, privilege_type, is_grantable
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = ANY(${expectedTables}::text[])
      AND grantee = 'booking_app'
    ORDER BY table_name, privilege_type
  `;

  const roleMemberships = await prisma.$queryRaw<
    readonly { role_name: string; member_name: string; admin_option: boolean }[]
  >`
    SELECT granted.rolname AS role_name,
           member.rolname AS member_name,
           membership.admin_option
    FROM pg_auth_members AS membership
    INNER JOIN pg_roles AS granted ON granted.oid = membership.roleid
    INNER JOIN pg_roles AS member ON member.oid = membership.member
    WHERE granted.rolname = 'booking_app'
       OR member.rolname = 'booking_app'
    ORDER BY granted.rolname, member.rolname
  `;

  const userPrivileges = await prisma.$queryRaw<
    readonly {
      can_select: boolean;
      can_insert: boolean;
      can_references: boolean;
    }[]
  >`
    SELECT has_table_privilege('booking_app', 'public.users', 'SELECT') AS can_select,
           has_table_privilege('booking_app', 'public.users', 'INSERT') AS can_insert,
           has_table_privilege('booking_app', 'public.users', 'REFERENCES') AS can_references
  `;

  const slug = `rbac-diag-${tenantId.slice(0, 8)}`;
  const email = `${userId}@example.test`;
  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name", "status")
    VALUES (${tenantId}::uuid, ${slug}, ${slug}, 'provisioning'::tenant_status)
  `;
  await prisma.$executeRaw`
    INSERT INTO "users" (
      "id", "normalized_email", "display_email", "status",
      "authorization_version", "created_at", "updated_at"
    )
    VALUES (
      ${userId}::uuid, ${email}, ${email}, 'active', 1,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;

  let membershipInsert: Record<string, unknown> = { ok: true };
  try {
    await runAsTenant(
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_memberships" (
          "id", "tenant_id", "user_id", "status", "authorization_version",
          "accepted_at", "created_at", "updated_at"
        )
        VALUES (
          ${membershipId}::uuid, ${tenantId}::uuid, ${userId}::uuid,
          'active'::tenant_membership_status, 1, CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `,
    );
  } catch (error) {
    membershipInsert = { ok: false, error: serializeError(error) };
  }

  assert.fail(
    `TENANT_RBAC_DIAGNOSTIC ${JSON.stringify({
      tableMetadata,
      grants,
      roleMemberships,
      userPrivileges,
      membershipInsert,
    })}`,
  );
});
