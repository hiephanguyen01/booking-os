import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];

async function runAsTenant<T>(
  tenantId: string | undefined,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
    if (tenantId) {
      await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    }
    return work(transaction);
  });
}

async function createTenantAndUser(): Promise<{ tenantId: string; userId: string }> {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const slug = `audit-${tenantId.slice(0, 8)}`;
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
  tenantIds.push(tenantId);
  userIds.push(userId);
  return { tenantId, userId };
}

after(async () => {
  try {
    if (tenantIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "tenants" WHERE "id" = ANY(${tenantIds}::uuid[])
      `;
    }
    if (userIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "users" WHERE "id" = ANY(${userIds}::uuid[])
      `;
    }
  } catch {
    // RED intentionally runs before tenant audit persistence exists.
  } finally {
    await prisma.$disconnect();
  }
});

test("tenant security audit rows use FORCE RLS and deny cross-tenant access", async () => {
  const tenantA = await createTenantAndUser();
  const tenantB = await createTenantAndUser();

  const table = await prisma.$queryRaw<readonly { rls_enabled: boolean; rls_forced: boolean }[]>`
    SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
    FROM pg_class
    WHERE oid = 'public.tenant_security_audit_events'::regclass
  `;
  assert.deepEqual(table, [{ rls_enabled: true, rls_forced: true }]);

  for (const current of [tenantA, tenantB]) {
    await runAsTenant(
      current.tenantId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_security_audit_events" (
          "id", "tenant_id", "event_type", "actor_user_id", "subject_user_id",
          "request_id", "metadata", "occurred_at"
        )
        VALUES (
          ${randomUUID()}::uuid, ${current.tenantId}::uuid, 'membership.test',
          ${current.userId}::uuid, ${current.userId}::uuid, 'req-audit',
          '{}'::jsonb, CURRENT_TIMESTAMP
        )
      `,
    );
  }

  const tenantARows = await runAsTenant(
    tenantA.tenantId,
    (transaction) => transaction.$queryRaw<readonly { tenant_id: string }[]>`
      SELECT "tenant_id" FROM "tenant_security_audit_events"
    `,
  );
  assert.deepEqual(tenantARows, [{ tenant_id: tenantA.tenantId }]);

  const missingContextRows = await runAsTenant(
    undefined,
    (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "tenant_security_audit_events"
    `,
  );
  assert.deepEqual(missingContextRows, []);

  const crossTenantUpdate = await runAsTenant(
    tenantA.tenantId,
    (transaction) => transaction.$executeRaw`
      UPDATE "tenant_security_audit_events"
      SET "metadata" = '{"changed":true}'::jsonb
      WHERE "tenant_id" = ${tenantB.tenantId}::uuid
    `,
  );
  assert.equal(crossTenantUpdate, 0);
});
