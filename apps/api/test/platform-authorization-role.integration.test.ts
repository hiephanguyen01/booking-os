import assert from "node:assert/strict";
import test, { after } from "node:test";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type AuthorizationDatabaseRole = "booking_app" | "booking_platform_app";

interface ColumnPrivilege {
  readonly columnName: string;
  readonly canSelect: boolean;
}

interface TablePrivileges {
  readonly canSelectAnyColumn: boolean;
  readonly canInsertAnyColumn: boolean;
  readonly canUpdateAnyColumn: boolean;
  readonly canDelete: boolean;
  readonly canTruncate: boolean;
  readonly canReferenceAnyColumn: boolean;
  readonly canTrigger: boolean;
}

after(async () => {
  await prisma.$disconnect();
});

async function queryAsRole<T>(role: AuthorizationDatabaseRole, sql: string): Promise<readonly T[]> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
    return transaction.$queryRawUnsafe<readonly T[]>(sql);
  });
}

async function executeAsRole(role: AuthorizationDatabaseRole, sql: string): Promise<number> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
    return transaction.$executeRawUnsafe(sql);
  });
}

function isInsufficientPrivilege(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly meta?: unknown };
  if (candidate.code !== "P2010" || typeof candidate.meta !== "object" || candidate.meta === null) {
    return false;
  }
  return (candidate.meta as { readonly code?: unknown }).code === "42501";
}

async function readColumnPrivileges(role: AuthorizationDatabaseRole): Promise<ColumnPrivilege[]> {
  return prisma.$queryRawUnsafe<ColumnPrivilege[]>(`
    SELECT
      column_name AS "columnName",
      has_column_privilege(
        '${role}',
        'public.users',
        column_name,
        'SELECT'
      ) AS "canSelect"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
    ORDER BY ordinal_position
  `);
}

async function readTablePrivileges(role: AuthorizationDatabaseRole): Promise<TablePrivileges> {
  const rows = await prisma.$queryRawUnsafe<readonly TablePrivileges[]>(`
    SELECT
      has_any_column_privilege('${role}', 'public.users', 'SELECT') AS "canSelectAnyColumn",
      has_any_column_privilege('${role}', 'public.users', 'INSERT') AS "canInsertAnyColumn",
      has_any_column_privilege('${role}', 'public.users', 'UPDATE') AS "canUpdateAnyColumn",
      has_table_privilege('${role}', 'public.users', 'DELETE') AS "canDelete",
      has_table_privilege('${role}', 'public.users', 'TRUNCATE') AS "canTruncate",
      has_any_column_privilege('${role}', 'public.users', 'REFERENCES') AS "canReferenceAnyColumn",
      has_table_privilege('${role}', 'public.users', 'TRIGGER') AS "canTrigger"
  `);
  assert.equal(rows.length, 1);
  return rows[0] as TablePrivileges;
}

test("booking_platform_app can read only the user fields needed for authorization", async () => {
  const columnPrivileges = await readColumnPrivileges("booking_platform_app");
  const readableColumns = columnPrivileges
    .filter(({ canSelect }) => canSelect)
    .map(({ columnName }) => columnName)
    .sort();

  assert.deepEqual(readableColumns, ["authorization_version", "id", "status"]);
  assert.deepEqual(await readTablePrivileges("booking_platform_app"), {
    canSelectAnyColumn: true,
    canInsertAnyColumn: false,
    canUpdateAnyColumn: false,
    canDelete: false,
    canTruncate: false,
    canReferenceAnyColumn: false,
    canTrigger: false,
  });
  assert.deepEqual(
    await queryAsRole(
      "booking_platform_app",
      'SELECT "id", "status", "authorization_version" FROM "users" LIMIT 0',
    ),
    [],
  );

  for (const column of ["normalized_email", "display_email", "created_at"] as const) {
    await assert.rejects(
      queryAsRole("booking_platform_app", `SELECT "${column}" FROM "users" LIMIT 0`),
      isInsufficientPrivilege,
    );
  }
});

test("booking_platform_app cannot mutate users and does not bypass RLS", async () => {
  const rows = await prisma.$queryRaw<readonly { bypassesRls: boolean }[]>`
    SELECT role_row.rolbypassrls AS "bypassesRls"
    FROM pg_roles AS role_row
    WHERE role_row.rolname = 'booking_platform_app'
  `;
  assert.deepEqual(rows, [{ bypassesRls: false }]);

  await assert.rejects(
    executeAsRole(
      "booking_platform_app",
      `INSERT INTO "users" ("normalized_email", "display_email")
       SELECT 'forbidden@example.test', 'forbidden@example.test'
       WHERE FALSE`,
    ),
    isInsufficientPrivilege,
  );
  await assert.rejects(
    executeAsRole(
      "booking_platform_app",
      'UPDATE "users" SET "authorization_version" = "authorization_version" WHERE FALSE',
    ),
    isInsufficientPrivilege,
  );
  await assert.rejects(
    executeAsRole("booking_platform_app", 'DELETE FROM "users" WHERE FALSE'),
    isInsufficientPrivilege,
  );
});

test("booking_app has no access to users", async () => {
  const columnPrivileges = await readColumnPrivileges("booking_app");
  assert.deepEqual(
    columnPrivileges.filter(({ canSelect }) => canSelect),
    [],
  );
  assert.deepEqual(await readTablePrivileges("booking_app"), {
    canSelectAnyColumn: false,
    canInsertAnyColumn: false,
    canUpdateAnyColumn: false,
    canDelete: false,
    canTruncate: false,
    canReferenceAnyColumn: false,
    canTrigger: false,
  });
  await assert.rejects(
    queryAsRole("booking_app", 'SELECT "id" FROM "users" LIMIT 0'),
    isInsufficientPrivilege,
  );
});
