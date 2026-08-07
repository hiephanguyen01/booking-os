import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import type { MembershipDataSession } from "../../../application/ports/membership-data-session.js";
import { PrismaPlatformTenantProvisioningTransactionAdapter } from "./prisma-platform-tenant-provisioning-transaction.adapter.js";

const tenantId = "550e8400-e29b-41d4-a716-446655440001";
const now = new Date("2026-08-07T12:00:00.000Z");

interface FakeTransaction {
  $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

interface SessionFactory {
  create(transaction: FakeTransaction, targetTenantId: string): MembershipDataSession;
}

type AdapterConstructor = new (
  prisma: PrismaService,
  sessionFactory: SessionFactory,
) => PrismaPlatformTenantProvisioningTransactionAdapter;

function createHarness() {
  const operations: string[] = [];
  let transactions = 0;
  const transaction: FakeTransaction = {
    async $queryRawUnsafe<T>(sql: string) {
      if (sql.includes('INSERT INTO "tenant_provisioning_requests"')) {
        operations.push("idempotency:claim");
        return [{ inserted: true }] as T;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async $executeRawUnsafe(sql, ...values) {
      if (sql === "SET LOCAL ROLE booking_app") {
        operations.push("role:tenant");
        return 0;
      }
      if (sql === "SET LOCAL ROLE NONE") {
        operations.push("role:global");
        return 0;
      }
      if (sql.includes('INSERT INTO "outbox_events"')) {
        operations.push(`outbox:${String(values[1])}:${String(values[0])}`);
        return 1;
      }
      if (sql.includes('UPDATE "tenant_provisioning_requests"')) {
        operations.push("idempotency:complete");
        return 1;
      }
      throw new Error(`Unexpected execute: ${sql}`);
    },
    async $executeRaw(_strings, ...values) {
      operations.push(`tenant:${String(values[0])}`);
      return 0;
    },
  };
  const prisma = {
    async $transaction<T>(work: (current: FakeTransaction) => Promise<T>): Promise<T> {
      transactions += 1;
      operations.push("transaction");
      return work(transaction);
    },
  } as unknown as PrismaService;
  const sessionFactory: SessionFactory = {
    create(current, targetTenantId) {
      assert.equal(current, transaction);
      operations.push(`factory:${targetTenantId}`);
      return Object.freeze({
        memberships: Object.freeze({}),
        invitations: Object.freeze({}),
        roles: Object.freeze({}),
        tenants: Object.freeze({}),
        audit: Object.freeze({}),
      }) as unknown as MembershipDataSession;
    },
  };
  const Constructor =
    PrismaPlatformTenantProvisioningTransactionAdapter as unknown as AdapterConstructor;

  return {
    adapter: new Constructor(prisma, sessionFactory),
    operations,
    transactionCount: () => transactions,
  };
}

test("keeps idempotency claim, tenant RLS writes, and completion in one transaction", async () => {
  const harness = createHarness();

  await harness.adapter.run(async (context) => {
    const claim = await context.idempotency.claim({
      key: "provision-1",
      requestHash: "hash-1",
      actorUserId: "550e8400-e29b-41d4-a716-446655440010",
      now,
    });
    assert.deepEqual(claim, { status: "claimed" });

    await context.runTenant(tenantId, async () => {
      harness.operations.push("tenant:work");
    });

    await context.idempotency.complete({
      key: "provision-1",
      requestHash: "hash-1",
      result: {
        tenantId,
        slug: "studio-one",
        status: "provisioning",
        ownerMembershipId: "550e8400-e29b-41d4-a716-446655440020",
        ownerInvitationId: "550e8400-e29b-41d4-a716-446655440030",
        replayed: false,
      },
      completedAt: now,
    });
  });

  assert.equal(harness.transactionCount(), 1);
  assert.deepEqual(harness.operations, [
    "transaction",
    "idempotency:claim",
    "role:tenant",
    `tenant:${tenantId}`,
    `factory:${tenantId}`,
    "tenant:work",
    "role:global",
    "idempotency:complete",
  ]);
});

test("provides a tenant-bound outbox inside the provisioning transaction", async () => {
  const harness = createHarness();
  const eventId = "550e8400-e29b-41d4-a716-446655440040";

  await harness.adapter.run(async (context) => {
    await context.runTenant(tenantId, async (session) => {
      await session.outbox.append({
        id: eventId,
        type: "membership.owner_invitation.requested.v1",
        aggregateType: "membership_invitation",
        aggregateId: "550e8400-e29b-41d4-a716-446655440030",
        payload: { version: 1 },
        occurredAt: now,
      });
    });
  });

  assert.equal(harness.transactionCount(), 1);
  assert.deepEqual(harness.operations, [
    "transaction",
    "role:tenant",
    `tenant:${tenantId}`,
    `factory:${tenantId}`,
    `outbox:${tenantId}:${eventId}`,
    "role:global",
  ]);
});

test("restores the global role when tenant work fails but the outer workflow handles it", async () => {
  const harness = createHarness();
  const expected = new Error("tenant write failed");

  await harness.adapter.run(async (context) => {
    await assert.rejects(
      context.runTenant(tenantId, async () => {
        throw expected;
      }),
      expected,
    );
    harness.operations.push("outer:handled");
  });

  assert.equal(harness.transactionCount(), 1);
  assert.deepEqual(harness.operations, [
    "transaction",
    "role:tenant",
    `tenant:${tenantId}`,
    `factory:${tenantId}`,
    "role:global",
    "outer:handled",
  ]);
});
