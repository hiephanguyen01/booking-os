import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { SYSTEM_ROLES } from "@booking-os/auth";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { BuildAuthorizationContextUseCase } from "../src/modules/authorization/application/use-cases/build-authorization-context.use-case.js";
import { DemoteOwnerUseCase } from "../src/modules/memberships/application/use-cases/demote-owner.use-case.js";
import { SuspendMembershipUseCase } from "../src/modules/memberships/application/use-cases/suspend-membership.use-case.js";
import {
  LastTenantOwnerError,
  MembershipRequiredError,
} from "../src/modules/memberships/domain/membership-errors.js";

const RUN_TAG = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();
const TENANT_SLUG = `pr26-members-${RUN_TAG}`;
const OTHER_TENANT_SLUG = `pr26-members-other-${RUN_TAG}`;
const OWNER_ONE_ID = randomUUID();
const OWNER_TWO_ID = randomUUID();
const CROSS_TENANT_USER_ID = randomUUID();
const OWNER_ONE_MEMBERSHIP_ID = randomUUID();
const OWNER_TWO_MEMBERSHIP_ID = randomUUID();
const CROSS_TENANT_MEMBERSHIP_ID = randomUUID();

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  HOST: process.env.HOST,
  TRUST_PROXY: process.env.TRUST_PROXY,
  TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
  PLATFORM_HOSTNAME: process.env.PLATFORM_HOSTNAME,
  PORT: process.env.PORT,
  API_PREFIX: process.env.API_PREFIX,
  APP_VERSION: process.env.APP_VERSION,
  LOG_LEVEL: process.env.LOG_LEVEL,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  READINESS_TIMEOUT_MS: process.env.READINESS_TIMEOUT_MS,
  SESSION_SECRET: process.env.SESSION_SECRET,
  SESSION_ALLOWED_ORIGINS: process.env.SESSION_ALLOWED_ORIGINS,
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
  IDENTITY_TOKEN_PEPPER: process.env.IDENTITY_TOKEN_PEPPER,
  IDENTITY_ENVELOPE_KEYS: process.env.IDENTITY_ENVELOPE_KEYS,
  IDENTITY_ACTIVE_ENVELOPE_KEY_ID: process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID,
};

let app: INestApplication;
let prisma: PrismaService;
let buildAuthorization: BuildAuthorizationContextUseCase;
let demoteOwner: DemoteOwnerUseCase;
let suspendMembership: SuspendMembershipUseCase;

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function ownerAuthorization(userId: string) {
  return buildAuthorization.execute({
    requestId: `pr26-authorization-${RUN_TAG}-${userId}`,
    traceId: randomUUID(),
    source: "internal",
    actorId: userId,
    sessionId: randomUUID(),
    tenantId: TENANT_ID,
    authScope: { type: "tenant", tenantId: TENANT_ID },
    sessionState: "active",
    authorizationVersion: 1,
    membershipAuthorizationVersion: 1,
  });
}

async function cleanup(): Promise<void> {
  await prisma?.tenant.deleteMany({ where: { id: { in: [TENANT_ID, OTHER_TENANT_ID] } } });
  await prisma?.user.deleteMany({
    where: { id: { in: [OWNER_ONE_ID, OWNER_TWO_ID, CROSS_TENANT_USER_ID] } },
  });
}

async function seed(): Promise<void> {
  const now = new Date();
  const ownerRole = await prisma.role.upsert({
    where: { key: SYSTEM_ROLES.tenantOwner },
    update: { scopeLevel: "tenant", isSystem: true },
    create: {
      id: randomUUID(),
      key: SYSTEM_ROLES.tenantOwner,
      scopeLevel: "tenant",
      isSystem: true,
    },
  });
  await prisma.role.upsert({
    where: { key: SYSTEM_ROLES.tenantAdmin },
    update: { scopeLevel: "tenant", isSystem: true },
    create: {
      id: randomUUID(),
      key: SYSTEM_ROLES.tenantAdmin,
      scopeLevel: "tenant",
      isSystem: true,
    },
  });

  await prisma.tenant.createMany({
    data: [
      {
        id: TENANT_ID,
        slug: TENANT_SLUG,
        name: "PR26 Membership Management",
        status: "provisioning",
      },
      {
        id: OTHER_TENANT_ID,
        slug: OTHER_TENANT_SLUG,
        name: "PR26 Cross Tenant",
        status: "provisioning",
      },
    ],
  });
  await prisma.user.createMany({
    data: [OWNER_ONE_ID, OWNER_TWO_ID, CROSS_TENANT_USER_ID].map((id, index) => ({
      id,
      normalizedEmail: `pr26-${RUN_TAG}-member-${index}@example.test`,
      displayEmail: `pr26-${RUN_TAG}-member-${index}@example.test`,
      status: "active" as const,
      authorizationVersion: 1,
      activatedAt: now,
    })),
  });
  await prisma.tenantMembership.createMany({
    data: [
      {
        id: OWNER_ONE_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: OWNER_ONE_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: now,
      },
      {
        id: OWNER_TWO_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: OWNER_TWO_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: now,
      },
      {
        id: CROSS_TENANT_MEMBERSHIP_ID,
        tenantId: OTHER_TENANT_ID,
        userId: CROSS_TENANT_USER_ID,
        status: "invited",
        authorizationVersion: 1,
      },
    ],
  });
  await prisma.roleAssignment.createMany({
    data: [OWNER_ONE_ID, OWNER_TWO_ID].map((userId) => ({
      id: randomUUID(),
      userId,
      roleId: ownerRole.id,
      scopeLevel: "tenant" as const,
      tenantId: TENANT_ID,
    })),
  });
  await prisma.tenant.update({ where: { id: TENANT_ID }, data: { status: "active" } });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = "platform.example.test";
  process.env.PORT = "3130";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_pr24_rls";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "membership-management-e2e-secret-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = `https://${TENANT_SLUG}.example.test`;
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.IDENTITY_TOKEN_PEPPER = Buffer.alloc(32, 3).toString("base64");
  process.env.IDENTITY_ENVELOPE_KEYS = JSON.stringify({
    "identity-v1": Buffer.alloc(32, 4).toString("base64"),
  });
  process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID = "identity-v1";

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  prisma = app.get(PrismaService);
  buildAuthorization = app.get(BuildAuthorizationContextUseCase);
  demoteOwner = app.get(DemoteOwnerUseCase);
  suspendMembership = app.get(SuspendMembershipUseCase);
  await cleanup();
  await seed();
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await app?.close();
    for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
      restoreEnvironmentValue(key);
    }
  }
});

test("cross-tenant membership IDs remain invisible to tenant membership mutations", async () => {
  const authorization = await ownerAuthorization(OWNER_ONE_ID);
  await assert.rejects(
    () =>
      suspendMembership.execute({
        authorization,
        membershipId: CROSS_TENANT_MEMBERSHIP_ID,
        requestId: `pr26-cross-tenant-${RUN_TAG}`,
      }),
    MembershipRequiredError,
  );

  const crossTenantMembership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { id: CROSS_TENANT_MEMBERSHIP_ID },
  });
  assert.equal(crossTenantMembership.status, "invited");
  assert.equal(crossTenantMembership.authorizationVersion, 1);
});

test("concurrent owner demotions serialize so exactly one active owner remains", async () => {
  const [ownerOneAuthorization, ownerTwoAuthorization] = await Promise.all([
    ownerAuthorization(OWNER_ONE_ID),
    ownerAuthorization(OWNER_TWO_ID),
  ]);
  const results = await Promise.allSettled([
    demoteOwner.execute({
      authorization: ownerOneAuthorization,
      membershipId: OWNER_ONE_MEMBERSHIP_ID,
      requestId: `pr26-demote-owner-one-${RUN_TAG}`,
    }),
    demoteOwner.execute({
      authorization: ownerTwoAuthorization,
      membershipId: OWNER_TWO_MEMBERSHIP_ID,
      requestId: `pr26-demote-owner-two-${RUN_TAG}`,
    }),
  ]);

  const fulfilled = results.filter(
    (
      result,
    ): result is PromiseFulfilledResult<Awaited<ReturnType<DemoteOwnerUseCase["execute"]>>> =>
      result.status === "fulfilled",
  );
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0]?.reason instanceof LastTenantOwnerError);

  const memberships = await prisma.tenantMembership.findMany({
    where: { id: { in: [OWNER_ONE_MEMBERSHIP_ID, OWNER_TWO_MEMBERSHIP_ID] } },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(
    memberships.map((membership) => membership.authorizationVersion).sort((a, b) => a - b),
    [1, 2],
  );
  assert.ok(memberships.every((membership) => membership.status === "active"));

  const assignments = await prisma.roleAssignment.findMany({
    where: { tenantId: TENANT_ID, userId: { in: [OWNER_ONE_ID, OWNER_TWO_ID] } },
    include: { role: true },
  });
  const activeOwnerAssignments = assignments.filter(
    (assignment) =>
      assignment.revokedAt === null && assignment.role.key === SYSTEM_ROLES.tenantOwner,
  );
  const activeAdminAssignments = assignments.filter(
    (assignment) =>
      assignment.revokedAt === null && assignment.role.key === SYSTEM_ROLES.tenantAdmin,
  );

  assert.equal(activeOwnerAssignments.length, 1);
  assert.equal(activeAdminAssignments.length, 1);
  assert.notEqual(activeOwnerAssignments[0]?.userId, activeAdminAssignments[0]?.userId);
});
