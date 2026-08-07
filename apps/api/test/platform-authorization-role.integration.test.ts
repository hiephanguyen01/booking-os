import assert from "node:assert/strict";
import test, { after } from "node:test";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

test("the non-bypass platform role can read users for database-backed authorization", async () => {
  const rows = await prisma.$queryRaw<
    readonly {
      canReadId: boolean;
      canReadStatus: boolean;
      canReadAuthorizationVersion: boolean;
      canReadEmail: boolean;
      bypassesRls: boolean;
    }[]
  >`
    SELECT
      has_column_privilege('booking_platform_app', 'public.users', 'id', 'SELECT') AS "canReadId",
      has_column_privilege('booking_platform_app', 'public.users', 'status', 'SELECT') AS "canReadStatus",
      has_column_privilege(
        'booking_platform_app',
        'public.users',
        'authorization_version',
        'SELECT'
      ) AS "canReadAuthorizationVersion",
      has_column_privilege(
        'booking_platform_app',
        'public.users',
        'normalized_email',
        'SELECT'
      ) AS "canReadEmail",
      role_row.rolbypassrls AS "bypassesRls"
    FROM pg_roles AS role_row
    WHERE role_row.rolname = 'booking_platform_app'
  `;

  assert.deepEqual(rows, [
    {
      canReadId: true,
      canReadStatus: true,
      canReadAuthorizationVersion: true,
      canReadEmail: false,
      bypassesRls: false,
    },
  ]);
});
