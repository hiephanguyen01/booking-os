import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { BOOKING_SESSION_COOKIE, SYSTEM_ROLES } from "@booking-os/auth";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { BuildAuthorizationContextUseCase } from "../src/modules/authorization/application/use-cases/build-authorization-context.use-case.js";
import { RevokeMembershipUseCase } from "../src/modules/memberships/application/use-cases/revoke-membership.use-case.js";
import { SuspendMembershipUseCase } from "../src/modules/memberships/application/use-cases/suspend-membership.use-case.js";
import { CreateSessionUseCase } from "../src/modules/sessions/application/use-cases/create-session.js";

const RUN_TAG = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();
const TENANT_SLUG = `pr26-revoke-${RUN_TAG}`;
const OTHER_TENANT_SLUG = `pr26-revoke-other-${RUN_TAG}`;
const HOSTNAME = `${TENANT_SLUG}.example.test`;
const OTHER_HOSTNAME = `${OTHER_TENANT_SLUG}.example.test`;
const OWNER_ID = randomUUID();
const OTHER_OWNER_ID = randomUUID();
const TARGET_ID = randomUUID();
const OWNER_MEMBERSHIP_ID = randomUUID();
const OTHER_OWNER_MEMBERSHIP_ID = randomUUID();
const TARGET_MEMBERSHIP_ID = randomUUID();
const OTHER_TARGET_MEMBERSHIP_ID = randomUUID();

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
let createSession: CreateSessionUseCase;
let revokeMembership: RevokeMembershipUseCase;
let suspendMembership: SuspendMembershipUseCase;
let tenantSession: Awaited<ReturnType<CreateSessionUseCase["execute"]>>;
let otherTenantSession: Awaited<ReturnType<CreateSessionUseCase["execute"]>>;

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function ownerAuthorization() {
  return buildAuthorization.execute({
    requestId: `pr26-owner-authorization-${RUN_TAG}`,
    traceId: randomUUID(),
    source: "internal",
    actorId: OWNER_ID,
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
  await prisma?.user.deleteMany({ where: { id: { in: [OWNER_ID, OTHER_OWNER_ID, TARGET_ID] } } });
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
  const adminRole = await prisma.role.upsert({
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
      { id: TENANT_ID, slug: TENANT_SLUG, name: "PR26 Revocation", status: "provisioning" },
      {
        id: OTHER_TENANT_ID,
        slug: OTHER_TENANT_SLUG,
        name: "PR26 Revocation Other",
        status: "provisioning",
      },
    ],
  });
  await prisma.tenantDomain.createMany({
    data: [
      { id: randomUUID(), tenantId: TENANT_ID, hostname: HOSTNAME, isPrimary: true },
      {
        id: randomUUID(),
        tenantId: OTHER_TENANT_ID,
        hostname: OTHER_HOSTNAME,
        isPrimary: true,
      },
    ],
  });
  await prisma.user.createMany({
    data: [OWNER_ID, OTHER_OWNER_ID, TARGET_ID].map((id, index) => ({
      id,
      normalizedEmail: `pr26-${RUN_TAG}-session-${index}@example.test`,
      displayEmail: `pr26-${RUN_TAG}-session-${index}@example.test`,
      status: "active" as const,
      authorizationVersion: 1,
      activatedAt: now,
    })),
  });
  await prisma.tenantMembership.createMany({
    data: [
      {
        id: OWNER_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: OWNER_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: now,
      },
      {
        id: TARGET_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: TARGET_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: now,
      },
      {
        id: OTHER_OWNER_MEMBERSHIP_ID,
        tenantId: OTHER_TENANT_ID,
        userId: OTHER_OWNER_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: now,
      },
      {
        id: OTHER_TARGET_MEMBERSHIP_ID,
        tenantId: OTHER_TENANT_ID,
        userId: TARGET_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: now,
      },
    ],
  });
  await prisma.roleAssignment.createMany({
    data: [
      {
        id: randomUUID(),
        userId: OWNER_ID,
        roleId: ownerRole.id,
        scopeLevel: "tenant",
        tenantId: TENANT_ID,
      },
      {
        id: randomUUID(),
        userId: TARGET_ID,
        roleId: adminRole.id,
        scopeLevel: "tenant",
        tenantId: TENANT_ID,
      },
      {
        id: randomUUID(),
        userId: OTHER_OWNER_ID,
        roleId: ownerRole.id,
        scopeLevel: "tenant",
        tenantId: OTHER_TENANT_ID,
      },
      {
        id: randomUUID(),
        userId: TARGET_ID,
        roleId: adminRole.id,
        scopeLevel: "tenant",
        tenantId: OTHER_TENANT_ID,
      },
    ],
  });
  await prisma.tenant.updateMany({
    where: { id: { in: [TENANT_ID, OTHER_TENANT_ID] } },
    data: { status: "active" },
  });

  tenantSession = await createSession.execute({
    userId: TARGET_ID,
    scope: { type: "tenant", tenantId: TENANT_ID },
    hostname: HOSTNAME,
    state: "active",
    authorizationVersion: 1,
    membershipAuthorizationVersion: 1,
    requestId: `pr26-target-session-${RUN_TAG}`,
  });
  otherTenantSession = await createSession.execute({
    userId: TARGET_ID,
    scope: { type: "tenant", tenantId: OTHER_TENANT_ID },
    hostname: OTHER_HOSTNAME,
    state: "active",
    authorizationVersion: 1,
    membershipAuthorizationVersion: 1,
    requestId: `pr26-other-target-session-${RUN_TAG}`,
  });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = "platform.example.test";
  process.env.PORT = "3131";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_pr24_rls";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "membership-session-revocation-secret-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = `https://${HOSTNAME}`;
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.IDENTITY_TOKEN_PEPPER = Buffer.alloc(32, 5).toString("base64");
  process.env.IDENTITY_ENVELOPE_KEYS = JSON.stringify({
    "identity-v1": Buffer.alloc(32, 6).toString("base64"),
  });
  process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID = "identity-v1";

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  prisma = app.get(PrismaService);
  buildAuthorization = app.get(BuildAuthorizationContextUseCase);
  createSession = app.get(CreateSessionUseCase);
  revokeMembership = app.get(RevokeMembershipUseCase);
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

test("suspension then revocation isolates the target tenant's membership and sessions", async () => {
  const tenantCookie = `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(tenantSession.token)}`;
  const otherTenantCookie = `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(otherTenantSession.token)}`;

  await request(app.getHttpServer())
    .get("/api/auth/me")
    .set("host", HOSTNAME)
    .set("cookie", tenantCookie)
    .expect(200);
  await request(app.getHttpServer())
    .get("/api/auth/me")
    .set("host", OTHER_HOSTNAME)
    .set("cookie", otherTenantCookie)
    .expect(200);

  const result = await suspendMembership.execute({
    authorization: await ownerAuthorization(),
    membershipId: TARGET_MEMBERSHIP_ID,
    requestId: `pr26-suspend-${RUN_TAG}`,
  });

  assert.equal(result.status, "suspended");
  assert.equal(result.authorizationVersion, 2);
  assert.equal(result.revokedSessionCount, 1);

  const tenantMembership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { id: TARGET_MEMBERSHIP_ID },
  });
  const otherTenantMembership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { id: OTHER_TARGET_MEMBERSHIP_ID },
  });
  assert.equal(tenantMembership.status, "suspended");
  assert.equal(tenantMembership.authorizationVersion, 2);
  assert.equal(otherTenantMembership.status, "active");
  assert.equal(otherTenantMembership.authorizationVersion, 1);

  const revokedSession = await prisma.authSession.findUniqueOrThrow({
    where: { id: tenantSession.session.id },
  });
  const unaffectedSession = await prisma.authSession.findUniqueOrThrow({
    where: { id: otherTenantSession.session.id },
  });
  const revokedTokens = await prisma.authSessionToken.findMany({
    where: { sessionId: tenantSession.session.id },
  });
  const unaffectedTokens = await prisma.authSessionToken.findMany({
    where: { sessionId: otherTenantSession.session.id },
  });

  assert.equal(revokedSession.state, "revoked");
  assert.notEqual(revokedSession.revokedAt, null);
  assert.ok(revokedTokens.every((token) => token.revokedAt !== null));
  assert.equal(unaffectedSession.state, "active");
  assert.equal(unaffectedSession.revokedAt, null);
  assert.ok(unaffectedTokens.every((token) => token.revokedAt === null));

  await request(app.getHttpServer())
    .get("/api/auth/me")
    .set("host", HOSTNAME)
    .set("cookie", tenantCookie)
    .expect(401);
  await request(app.getHttpServer())
    .get("/api/auth/me")
    .set("host", OTHER_HOSTNAME)
    .set("cookie", otherTenantCookie)
    .expect(200);

  const revokeResult = await revokeMembership.execute({
    authorization: await ownerAuthorization(),
    membershipId: TARGET_MEMBERSHIP_ID,
    requestId: `pr26-revoke-${RUN_TAG}`,
  });

  assert.equal(revokeResult.status, "revoked");
  assert.equal(revokeResult.authorizationVersion, 3);
  assert.equal(revokeResult.revokedSessionCount, 0);

  const revokedMembership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { id: TARGET_MEMBERSHIP_ID },
  });
  const stillActiveOtherTenantMembership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { id: OTHER_TARGET_MEMBERSHIP_ID },
  });
  assert.equal(revokedMembership.status, "revoked");
  assert.equal(revokedMembership.authorizationVersion, 3);
  assert.equal(stillActiveOtherTenantMembership.status, "active");
  assert.equal(stillActiveOtherTenantMembership.authorizationVersion, 1);

  const stillRevokedSession = await prisma.authSession.findUniqueOrThrow({
    where: { id: tenantSession.session.id },
  });
  const stillRevokedTokens = await prisma.authSessionToken.findMany({
    where: { sessionId: tenantSession.session.id },
  });
  const stillLiveOtherTenantSession = await prisma.authSession.findUniqueOrThrow({
    where: { id: otherTenantSession.session.id },
  });
  const stillLiveOtherTenantTokens = await prisma.authSessionToken.findMany({
    where: { sessionId: otherTenantSession.session.id },
  });
  assert.equal(stillRevokedSession.state, "revoked");
  assert.notEqual(stillRevokedSession.revokedAt, null);
  assert.ok(stillRevokedTokens.every((token) => token.revokedAt !== null));
  assert.equal(stillLiveOtherTenantSession.state, "active");
  assert.equal(stillLiveOtherTenantSession.revokedAt, null);
  assert.ok(stillLiveOtherTenantTokens.every((token) => token.revokedAt === null));

  await request(app.getHttpServer())
    .get("/api/auth/me")
    .set("host", HOSTNAME)
    .set("cookie", tenantCookie)
    .expect(401);
  await request(app.getHttpServer())
    .get("/api/auth/me")
    .set("host", OTHER_HOSTNAME)
    .set("cookie", otherTenantCookie)
    .expect(200);
});
