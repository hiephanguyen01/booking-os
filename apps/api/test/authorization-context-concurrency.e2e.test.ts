import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { createSessionToken, deriveSessionSecretDigest, parseSessionToken } from "@booking-os/auth";

import type { Environment } from "../src/config/environment.schema.js";
import { EnvironmentService } from "../src/config/environment.service.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { PrismaTenantDataSessionFactory } from "../src/database/prisma-tenant-data-session.factory.js";
import { BuildAuthorizationContextUseCase } from "../src/modules/authorization/application/use-cases/build-authorization-context.use-case.js";
import { ReconcileAuthorizationVersionUseCase } from "../src/modules/authorization/application/use-cases/reconcile-authorization-version.use-case.js";
import { PrismaAuthorizationRepositoryAdapter } from "../src/modules/authorization/infrastructure/persistence/prisma/prisma-authorization-repository.adapter.js";
import { PrismaSessionAuthorizationRefreshAdapter } from "../src/modules/authorization/infrastructure/persistence/prisma/prisma-session-authorization-refresh.adapter.js";
import {
  TenantAuthorizationStaleError,
  TenantExecutionIdentityConflictError,
} from "../src/modules/tenancy/application/tenant-context.errors.js";
import { requireAuthorizedTenantExecutionContext } from "../src/modules/tenancy/application/tenant-execution-context.js";
import { PrismaTenantTransactionAdapter } from "../src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.js";

const TENANT_ID = "a1000000-0000-4000-8000-000000000001";
const USER_ID = "a2000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "a3000000-0000-4000-8000-000000000001";
const SESSION_ID = "a4000000-0000-4000-8000-000000000001";
const TOKEN_ID = "a5000000-0000-4000-8000-000000000001";
const HOSTNAME = "authorization-concurrency.example.test";
const SESSION_SECRET = "authorization-concurrency-secret-at-least-32-characters";

const environment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  trustProxy: false,
  tenantBaseDomain: "example.test",
  port: 3101,
  apiPrefix: "api",
  appVersion: "0.1.0-e2e",
  logLevel: "error",
  databaseUrl:
    process.env.DATABASE_URL ?? "postgresql://booking:booking@127.0.0.1:5432/booking_os_test",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379/1",
  readinessTimeoutMs: 750,
  sessionSecret: SESSION_SECRET,
  paymentProvider: "mock",
};

let prisma: PrismaService;
let transactions: PrismaTenantTransactionAdapter;
let reconciliation: ReconcileAuthorizationVersionUseCase;
let presentedToken: string;

function digestKey(): Uint8Array {
  return createHash("sha256")
    .update("booking-os/session-token-digest/v1\0", "utf8")
    .update(SESSION_SECRET, "utf8")
    .digest();
}

async function cleanup(): Promise<void> {
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

before(async () => {
  const environmentService = new EnvironmentService(environment);
  prisma = new PrismaService(environmentService);
  transactions = new PrismaTenantTransactionAdapter(
    prisma,
    new PrismaTenantDataSessionFactory(environmentService),
  );
  reconciliation = new ReconcileAuthorizationVersionUseCase(
    new BuildAuthorizationContextUseCase(
      new PrismaAuthorizationRepositoryAdapter(prisma, transactions),
    ),
    new PrismaSessionAuthorizationRefreshAdapter(prisma, environmentService),
  );
  await prisma.$connect();
  await cleanup();

  const role = await prisma.role.upsert({
    where: { key: "tenant_owner" },
    update: { scopeLevel: "tenant", isSystem: true },
    create: { key: "tenant_owner", scopeLevel: "tenant", isSystem: true },
  });
  const permission = await prisma.permission.upsert({
    where: { key: "tenant.membership.read" },
    update: { scopeLevel: "tenant", description: "Read tenant memberships" },
    create: {
      key: "tenant.membership.read",
      scopeLevel: "tenant",
      description: "Read tenant memberships",
    },
  });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    update: {},
    create: { roleId: role.id, permissionId: permission.id },
  });
  await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      slug: "authorization-concurrency",
      name: "Authorization Concurrency",
      status: "provisioning",
    },
  });
  await prisma.user.create({
    data: {
      id: USER_ID,
      normalizedEmail: "authorization-concurrency@example.test",
      displayEmail: "authorization-concurrency@example.test",
      status: "active",
      authorizationVersion: 2,
      activatedAt: new Date(),
    },
  });
  await prisma.tenantMembership.create({
    data: {
      id: MEMBERSHIP_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      status: "active",
      authorizationVersion: 2,
      acceptedAt: new Date(),
    },
  });
  await prisma.roleAssignment.create({
    data: {
      id: randomUUID(),
      userId: USER_ID,
      roleId: role.id,
      scopeLevel: "tenant",
      tenantId: TENANT_ID,
    },
  });
  await prisma.tenant.update({ where: { id: TENANT_ID }, data: { status: "active" } });

  presentedToken = createSessionToken();
  const parsed = parseSessionToken(presentedToken);
  if (!parsed) throw new TypeError("Test session token must be valid.");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  const idleExpiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  await prisma.authSession.create({
    data: {
      id: SESSION_ID,
      userId: USER_ID,
      scopeType: "tenant",
      tenantId: TENANT_ID,
      hostname: HOSTNAME,
      state: "active",
      authorizationVersion: 1,
      membershipAuthorizationVersion: 1,
      idleExpiresAt,
      absoluteExpiresAt: expiresAt,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await prisma.authSessionToken.create({
    data: {
      id: TOKEN_ID,
      sessionId: SESSION_ID,
      scopeType: "tenant",
      tenantId: TENANT_ID,
      selector: parsed.selector,
      tokenHash: deriveSessionSecretDigest({ digestKey: digestKey(), secret: parsed.secret }),
      issuedAt: now,
      expiresAt,
    },
  });
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("version reconciliation rotates the token and stale authority cannot enter tenant work", async () => {
  const result = await reconciliation.execute({
    authenticated: {
      requestId: "authorization-concurrency",
      traceId: "a6000000-0000-4000-8000-000000000001",
      source: "internal",
      actorId: USER_ID,
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
      authScope: { type: "tenant", tenantId: TENANT_ID },
      sessionState: "active",
      authorizationVersion: 1,
      membershipAuthorizationVersion: 1,
    },
    presentedToken,
  });
  assert.equal(result.status, "refreshed");

  const stored = await prisma.authSession.findUniqueOrThrow({ where: { id: SESSION_ID } });
  assert.equal(stored.authorizationVersion, 2);
  assert.equal(stored.membershipAuthorizationVersion, 2);
  const successor = parseSessionToken(result.successorToken);
  assert.ok(successor);
  assert.ok(await prisma.authSessionToken.findUnique({ where: { selector: successor.selector } }));

  const candidateContext = {
    requestId: "stale-tenant-work",
    traceId: "a7000000-0000-4000-8000-000000000001",
    source: "internal" as const,
    tenantId: TENANT_ID,
    actorId: USER_ID,
    sessionId: SESSION_ID,
    authorization: result.context,
  };
  const tenantContext = requireAuthorizedTenantExecutionContext(candidateContext);
  await prisma.tenantMembership.update({
    where: { id: MEMBERSHIP_ID },
    data: { authorizationVersion: { increment: 1 } },
  });
  let workCalls = 0;
  await assert.rejects(
    transactions.run(tenantContext, async () => {
      workCalls += 1;
    }),
    TenantAuthorizationStaleError,
  );
  assert.equal(workCalls, 0);

  const versionThreeContext = {
    ...tenantContext,
    authorization: { ...tenantContext.authorization, membershipAuthorizationVersion: 3 },
  };
  let updateSettled = false;
  let concurrentUpdate: Promise<unknown> | undefined;
  await transactions.run(versionThreeContext, async () => {
    concurrentUpdate = prisma.tenantMembership
      .update({
        where: { id: MEMBERSHIP_ID },
        data: { authorizationVersion: { increment: 1 } },
      })
      .finally(() => {
        updateSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(updateSettled, false, "membership update must wait for the authority row lock");
  });
  await concurrentUpdate;
  assert.equal(updateSettled, true);

  await transactions.run(
    {
      ...tenantContext,
      authorization: { ...tenantContext.authorization, membershipAuthorizationVersion: 4 },
    },
    async () => {
      await assert.rejects(
        transactions.run(
          { ...tenantContext, sessionId: "a8000000-0000-4000-8000-000000000001" },
          async () => undefined,
        ),
        TenantExecutionIdentityConflictError,
      );
    },
  );
});
