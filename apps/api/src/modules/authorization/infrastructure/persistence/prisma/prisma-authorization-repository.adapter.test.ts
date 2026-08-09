import assert from "node:assert/strict";
import test from "node:test";

import { PrismaAuthorizationRepositoryAdapter } from "./prisma-authorization-repository.adapter.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const TENANT_ID = "30000000-0000-4000-8000-000000000001";

test("loads platform authority under the platform database role", async () => {
  const statements: string[] = [];
  const transaction = {
    async $executeRawUnsafe(statement: string) {
      statements.push(statement);
      return 0;
    },
    async $queryRawUnsafe(_statement: string, userId: string) {
      assert.equal(userId, USER_ID);
      return [
        {
          userAuthorizationVersion: 4,
          roleKeys: ["platform_admin"],
          permissionKeys: ["platform.tenants.provision"],
        },
      ];
    },
  };
  const prisma = {
    async $transaction<T>(work: (value: typeof transaction) => Promise<T>) {
      return work(transaction);
    },
  };
  const repository = new PrismaAuthorizationRepositoryAdapter(
    prisma as never,
    {
      async run() {
        throw new Error("tenant transaction must not run for platform scope");
      },
    } as never,
  );

  const result = await repository.loadCurrentScope({
    userId: USER_ID,
    scope: { type: "platform" },
    execution: {
      requestId: "request-platform",
      traceId: "trace-platform",
      source: "internal",
      actorId: USER_ID,
    },
  });

  assert.deepEqual(result, {
    scope: { type: "platform" },
    userAuthorizationVersion: 4,
    roleKeys: ["platform_admin"],
    permissionKeys: ["platform.tenants.provision"],
  });
  assert.deepEqual(statements, ["SET LOCAL ROLE booking_platform_app", "SET LOCAL ROLE NONE"]);
});

test("loads only the requested tenant authority inside its tenant transaction", async () => {
  let execution: unknown;
  const prisma = {
    user: {
      async findUnique(input: unknown) {
        assert.deepEqual(input, {
          where: { id: USER_ID, status: "active" },
          select: { authorizationVersion: true },
        });
        return { authorizationVersion: 6 };
      },
    },
  };
  const transactions = {
    async run(context: unknown, work: (session: unknown) => Promise<unknown>) {
      execution = context;
      return work({
        authorization: {
          async loadActiveTenantAuthorization(userId: string) {
            assert.equal(userId, USER_ID);
            return {
              tenantSlug: "acme",
              membershipId: "40000000-0000-4000-8000-000000000001",
              membershipStatus: "active" as const,
              membershipAuthorizationVersion: 9,
              roleKeys: ["tenant_owner" as const],
              permissionKeys: ["tenant.membership.read" as const],
            };
          },
        },
      });
    },
  };
  const repository = new PrismaAuthorizationRepositoryAdapter(
    prisma as never,
    transactions as never,
  );

  const result = await repository.loadCurrentScope({
    userId: USER_ID,
    scope: { type: "tenant", tenantId: TENANT_ID },
    execution: {
      requestId: "request-tenant",
      traceId: "trace-tenant",
      source: "internal",
      actorId: USER_ID,
    },
  });

  assert.deepEqual(execution, {
    tenantId: TENANT_ID,
    requestId: "request-tenant",
    traceId: "trace-tenant",
    source: "internal",
    actorId: USER_ID,
  });
  assert.deepEqual(result, {
    scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
    userAuthorizationVersion: 6,
    membershipId: "40000000-0000-4000-8000-000000000001",
    membershipStatus: "active",
    membershipAuthorizationVersion: 9,
    roleKeys: ["tenant_owner"],
    permissionKeys: ["tenant.membership.read"],
  });
});

test("fails closed when active user or current-scope authority is unavailable", async () => {
  const inactive = new PrismaAuthorizationRepositoryAdapter(
    {
      user: { findUnique: async () => null },
    } as never,
    { run: async () => assert.fail("tenant transaction must not run") } as never,
  );
  assert.equal(
    await inactive.loadCurrentScope({
      userId: USER_ID,
      scope: { type: "tenant", tenantId: TENANT_ID },
      execution: {
        requestId: "request-inactive",
        traceId: "trace-inactive",
        source: "internal",
        actorId: USER_ID,
      },
    }),
    null,
  );
});
