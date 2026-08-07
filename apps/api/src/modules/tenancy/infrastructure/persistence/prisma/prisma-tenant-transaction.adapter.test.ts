import assert from "node:assert/strict";
import test from "node:test";

import type { TenantExecutionContext } from "@booking-os/contracts";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import type { TenantDataSession } from "../../../application/ports/tenant-transaction.port.js";
import {
  InvalidTenantContextError,
  TenantContextConflictError,
} from "../../../application/tenant-context.errors.js";
import { PrismaTenantTransactionAdapter } from "./prisma-tenant-transaction.adapter.js";

const tenantA: TenantExecutionContext = {
  requestId: "req-1",
  traceId: "550e8400-e29b-41d4-a716-446655440000",
  source: "internal",
  tenantId: "550e8400-e29b-41d4-a716-446655440001",
};
const tenantB: TenantExecutionContext = {
  ...tenantA,
  tenantId: "550e8400-e29b-41d4-a716-446655440002",
};

interface FakeTransaction {
  readonly tenantProbe: {
    findMany(query: unknown): Promise<readonly unknown[]>;
  };
  $executeRawUnsafe(sql: string): Promise<number>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

interface SessionFactory {
  create(transaction: FakeTransaction, tenantId: string): TenantDataSession;
}

type AdapterConstructor = new (
  prisma: PrismaService,
  sessionFactory: SessionFactory,
) => PrismaTenantTransactionAdapter;

function createHarness() {
  const operations: string[] = [];
  let transactions = 0;
  const transaction: FakeTransaction = {
    tenantProbe: {
      async findMany() {
        operations.push("list");
        return [];
      },
    },
    async $executeRawUnsafe(sql) {
      operations.push(`unsafe:${sql}`);
      return 0;
    },
    async $executeRaw(_strings, ...values) {
      operations.push(`config:${String(values[0])}`);
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
    create(current, tenantId) {
      assert.equal(current, transaction);
      operations.push(`factory:${tenantId}`);
      return Object.freeze({
        tenantProbes: {
          async list() {
            return current.tenantProbe.findMany({});
          },
        },
        memberships: Object.freeze({}),
        invitations: Object.freeze({}),
        roles: Object.freeze({}),
        tenants: Object.freeze({}),
        audit: Object.freeze({}),
      }) as unknown as TenantDataSession;
    },
  };
  const Constructor = PrismaTenantTransactionAdapter as unknown as AdapterConstructor;

  return {
    adapter: new Constructor(prisma, sessionFactory),
    operations,
    transactionCount: () => transactions,
  };
}

test("rejects malformed tenant before opening a transaction", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.adapter.run({ ...tenantA, tenantId: "tenant-a" }, async () => undefined),
    InvalidTenantContextError,
  );
  assert.equal(harness.transactionCount(), 0);
});

test("sets role and tenant before exposing the complete tenant data session", async () => {
  const harness = createHarness();

  const keys = await harness.adapter.run(tenantA, async (session) => {
    harness.operations.push("work");
    await session.tenantProbes.list();
    return Object.keys(session);
  });

  assert.deepEqual(harness.operations, [
    "transaction",
    "unsafe:SET LOCAL ROLE booking_app",
    `config:${tenantA.tenantId}`,
    `factory:${tenantA.tenantId}`,
    "work",
    "list",
  ]);
  assert.deepEqual(keys, [
    "tenantProbes",
    "memberships",
    "invitations",
    "roles",
    "tenants",
    "audit",
  ]);
});

test("reuses same-tenant nested session and rejects tenant switching", async () => {
  const harness = createHarness();

  await harness.adapter.run(tenantA, async (outer) => {
    await harness.adapter.run(tenantA, async (inner) => {
      assert.equal(inner, outer);
    });
    await assert.rejects(
      harness.adapter.run(tenantB, async () => undefined),
      TenantContextConflictError,
    );
  });

  assert.equal(harness.transactionCount(), 1);
});

test("propagates callback failures", async () => {
  const harness = createHarness();
  const expected = new Error("work failed");

  await assert.rejects(
    harness.adapter.run(tenantA, async () => {
      throw expected;
    }),
    expected,
  );
});
