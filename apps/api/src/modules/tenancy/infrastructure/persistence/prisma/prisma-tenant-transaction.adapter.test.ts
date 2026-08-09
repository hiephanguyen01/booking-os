import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuthorizedTenantExecutionContext,
  TenantExecutionContext,
} from "@booking-os/contracts";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import type { TenantDataSession } from "../../../application/ports/tenant-transaction.port.js";
import {
  InvalidTenantContextError,
  TenantAuthorizationStaleError,
  TenantContextConflictError,
  TenantExecutionIdentityConflictError,
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
const authorizedTenantA: AuthorizedTenantExecutionContext = {
  ...tenantA,
  actorId: "650e8400-e29b-41d4-a716-446655440000",
  sessionId: "750e8400-e29b-41d4-a716-446655440000",
  authorization: {
    userId: "650e8400-e29b-41d4-a716-446655440000",
    sessionId: "750e8400-e29b-41d4-a716-446655440000",
    scope: { type: "tenant", tenantId: tenantA.tenantId, tenantSlug: "alpha" },
    membershipId: "850e8400-e29b-41d4-a716-446655440000",
    membershipStatus: "active",
    roleKeys: ["tenant_admin"],
    permissionKeys: ["tenant.membership.read"],
    userAuthorizationVersion: 2,
    membershipAuthorizationVersion: 3,
  },
};

interface FakeTransaction {
  readonly tenantProbe: {
    findMany(query: unknown): Promise<readonly unknown[]>;
  };
  $executeRawUnsafe(sql: string): Promise<number>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T>(sql: string): Promise<T>;
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
  let userAuthorizationVersion = 2;
  let membershipAuthorizationVersion = 3;
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
    async $queryRawUnsafe<T>(sql: string) {
      if (sql.includes('FROM "users"')) {
        operations.push("lock-user-authority");
        return [{ status: "active", authorizationVersion: userAuthorizationVersion }] as T;
      }
      operations.push("lock-membership-authority");
      return [
        {
          id: authorizedTenantA.authorization.membershipId,
          authorizationVersion: membershipAuthorizationVersion,
        },
      ] as T;
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
        authorization: {
          async loadActiveTenantAuthorization() {
            operations.push("load-tenant-authority");
            return {
              tenantSlug: "alpha",
              membershipId: authorizedTenantA.authorization.membershipId,
              membershipStatus: "active" as const,
              membershipAuthorizationVersion,
              roleKeys: authorizedTenantA.authorization.roleKeys,
              permissionKeys: authorizedTenantA.authorization.permissionKeys,
            };
          },
        },
      }) as unknown as TenantDataSession;
    },
  };
  const Constructor = PrismaTenantTransactionAdapter as unknown as AdapterConstructor;

  return {
    adapter: new Constructor(prisma, sessionFactory),
    operations,
    transactionCount: () => transactions,
    changeUserVersion: (version: number) => {
      userAuthorizationVersion = version;
    },
    changeMembershipVersion: (version: number) => {
      membershipAuthorizationVersion = version;
    },
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
    "authorization",
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

test("locks and revalidates authorized tenant execution before exposing the session", async () => {
  const harness = createHarness();

  await harness.adapter.run(authorizedTenantA, async () => {
    harness.operations.push("authorized-work");
  });

  assert.deepEqual(harness.operations.slice(0, 7), [
    "transaction",
    "lock-user-authority",
    "unsafe:SET LOCAL ROLE booking_app",
    `config:${tenantA.tenantId}`,
    "lock-membership-authority",
    `factory:${tenantA.tenantId}`,
    "load-tenant-authority",
  ]);
  assert.equal(harness.operations.at(-1), "authorized-work");
});

test("rejects stale global or membership authority before invoking work", async () => {
  for (const change of ["user", "membership"] as const) {
    const harness = createHarness();
    if (change === "user") harness.changeUserVersion(4);
    else harness.changeMembershipVersion(5);
    let workCalls = 0;

    await assert.rejects(
      harness.adapter.run(authorizedTenantA, async () => {
        workCalls += 1;
      }),
      TenantAuthorizationStaleError,
    );
    assert.equal(workCalls, 0, change);
  }
});

test("nested authorized execution cannot switch actor session or authority snapshot", async () => {
  const harness = createHarness();

  await harness.adapter.run(authorizedTenantA, async () => {
    for (const nested of [
      { ...authorizedTenantA, actorId: "950e8400-e29b-41d4-a716-446655440000" },
      { ...authorizedTenantA, sessionId: "a50e8400-e29b-41d4-a716-446655440000" },
      {
        ...authorizedTenantA,
        authorization: {
          ...authorizedTenantA.authorization,
          membershipAuthorizationVersion: 4,
        },
      },
    ]) {
      await assert.rejects(
        harness.adapter.run(nested as AuthorizedTenantExecutionContext, async () => undefined),
        TenantExecutionIdentityConflictError,
      );
    }
  });
});
