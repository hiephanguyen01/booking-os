import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { BOOKING_SESSION_COOKIE } from "@booking-os/auth";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { CreateSessionUseCase } from "../src/modules/sessions/application/use-cases/create-session.js";

const RUN_TAG = randomUUID().slice(0, 8);
const PLATFORM_HOSTNAME = "platform.example.test";
const PLATFORM_USER_ID = randomUUID();
const TENANT_USER_ID = randomUUID();
const TENANT_ID = randomUUID();
const TENANT_SLUG = `auth-endpoint-${RUN_TAG}`;
const TENANT_HOSTNAME = `${TENANT_SLUG}.example.test`;
const TENANT_MEMBERSHIP_ID = randomUUID();

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

interface SessionFixture {
  readonly cookie: string;
  readonly sessionId: string;
  readonly hostname: string;
}

let app: INestApplication;
let prisma: PrismaService;
let createSession: CreateSessionUseCase;
let platformSession: SessionFixture;
let tenantSession: SessionFixture;

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function cleanup(): Promise<void> {
  await prisma?.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma?.user.deleteMany({ where: { id: { in: [PLATFORM_USER_ID, TENANT_USER_ID] } } });
}

async function ensureCatalog(): Promise<{
  readonly platformRoleId: string;
  readonly tenantRoleId: string;
}> {
  const platformRole = await prisma.role.upsert({
    where: { key: "platform_admin" },
    update: { scopeLevel: "platform", isSystem: true },
    create: { id: randomUUID(), key: "platform_admin", scopeLevel: "platform", isSystem: true },
  });
  const tenantRole = await prisma.role.upsert({
    where: { key: "tenant_owner" },
    update: { scopeLevel: "tenant", isSystem: true },
    create: { id: randomUUID(), key: "tenant_owner", scopeLevel: "tenant", isSystem: true },
  });
  const platformPermission = await prisma.permission.upsert({
    where: { key: "platform.tenants.provision" },
    update: { scopeLevel: "platform", description: "Provision tenants." },
    create: {
      id: randomUUID(),
      key: "platform.tenants.provision",
      scopeLevel: "platform",
      description: "Provision tenants.",
    },
  });
  const tenantPermission = await prisma.permission.upsert({
    where: { key: "tenant.membership.read" },
    update: { scopeLevel: "tenant", description: "Read tenant memberships." },
    create: {
      id: randomUUID(),
      key: "tenant.membership.read",
      scopeLevel: "tenant",
      description: "Read tenant memberships.",
    },
  });
  for (const [roleId, permissionId] of [
    [platformRole.id, platformPermission.id],
    [tenantRole.id, tenantPermission.id],
  ] as const) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      update: {},
      create: { roleId, permissionId },
    });
  }
  return { platformRoleId: platformRole.id, tenantRoleId: tenantRole.id };
}

async function seed(): Promise<void> {
  const { platformRoleId, tenantRoleId } = await ensureCatalog();
  const now = new Date();
  await prisma.user.createMany({
    data: [
      {
        id: PLATFORM_USER_ID,
        normalizedEmail: `auth-endpoint-platform-${RUN_TAG}@example.test`,
        displayEmail: `auth-endpoint-platform-${RUN_TAG}@example.test`,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
      {
        id: TENANT_USER_ID,
        normalizedEmail: `auth-endpoint-tenant-${RUN_TAG}@example.test`,
        displayEmail: `auth-endpoint-tenant-${RUN_TAG}@example.test`,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
    ],
  });
  await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      slug: TENANT_SLUG,
      name: "Authorization Endpoint",
      status: "provisioning",
    },
  });
  await prisma.tenantDomain.create({
    data: { id: randomUUID(), tenantId: TENANT_ID, hostname: TENANT_HOSTNAME, isPrimary: true },
  });
  await prisma.tenantMembership.create({
    data: {
      id: TENANT_MEMBERSHIP_ID,
      tenantId: TENANT_ID,
      userId: TENANT_USER_ID,
      status: "active",
      authorizationVersion: 1,
      acceptedAt: now,
    },
  });
  await prisma.roleAssignment.createMany({
    data: [
      {
        id: randomUUID(),
        userId: PLATFORM_USER_ID,
        roleId: platformRoleId,
        scopeLevel: "platform",
        tenantId: null,
      },
      {
        id: randomUUID(),
        userId: TENANT_USER_ID,
        roleId: tenantRoleId,
        scopeLevel: "tenant",
        tenantId: TENANT_ID,
      },
    ],
  });
  await prisma.tenant.update({ where: { id: TENANT_ID }, data: { status: "active" } });

  const platform = await createSession.execute({
    userId: PLATFORM_USER_ID,
    scope: { type: "platform" },
    hostname: PLATFORM_HOSTNAME,
    state: "active",
    authorizationVersion: 1,
    requestId: `auth-endpoint-platform-${RUN_TAG}`,
  });
  platformSession = {
    cookie: `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(platform.token)}`,
    sessionId: platform.session.id,
    hostname: PLATFORM_HOSTNAME,
  };

  const tenant = await createSession.execute({
    userId: TENANT_USER_ID,
    scope: { type: "tenant", tenantId: TENANT_ID },
    hostname: TENANT_HOSTNAME,
    state: "active",
    authorizationVersion: 1,
    membershipAuthorizationVersion: 1,
    requestId: `auth-endpoint-tenant-${RUN_TAG}`,
  });
  tenantSession = {
    cookie: `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(tenant.token)}`,
    sessionId: tenant.session.id,
    hostname: TENANT_HOSTNAME,
  };
}

function assertPrivateAuthorizationResponse(response: request.Response): void {
  assert.equal(response.headers["cache-control"], "private, no-store");
  const vary = String(response.headers.vary ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  assert.ok(vary.includes("cookie"));
  assert.ok(vary.includes("origin"));
  assert.equal(response.headers.etag, undefined);
  assert.match(String(response.headers["content-type"]), /^application\/json; charset=utf-8$/u);
  assert.doesNotMatch(JSON.stringify(response.body), /password|hash|token|credential|abuse/iu);
  assert.equal("memberships" in response.body, false);
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = PLATFORM_HOSTNAME;
  process.env.PORT = "3134";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_pr24_rls";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "authorization-endpoint-e2e-secret-at-least-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = `https://${PLATFORM_HOSTNAME},https://${TENANT_HOSTNAME}`;
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.IDENTITY_TOKEN_PEPPER = Buffer.alloc(32, 7).toString("base64");
  process.env.IDENTITY_ENVELOPE_KEYS = JSON.stringify({
    "identity-v1": Buffer.alloc(32, 8).toString("base64"),
  });
  process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID = "identity-v1";

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  prisma = app.get(PrismaService);
  createSession = app.get(CreateSessionUseCase);
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

test("GET /auth/me/authorization protects unauthenticated responses from browser caching", async () => {
  const response = await request(app.getHttpServer())
    .get("/api/auth/me/authorization")
    .set("host", PLATFORM_HOSTNAME)
    .expect(401);

  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(
    response.headers["content-security-policy"],
    "default-src 'none'; frame-ancestors 'none'",
  );
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
});

test("GET /auth/me/authorization returns only current platform authority with private cache headers", async () => {
  const response = await request(app.getHttpServer())
    .get("/api/auth/me/authorization")
    .set("host", platformSession.hostname)
    .set("origin", `https://${platformSession.hostname}`)
    .set("cookie", platformSession.cookie)
    .expect(200);

  assertPrivateAuthorizationResponse(response);
  assert.equal(response.body.userId, PLATFORM_USER_ID);
  assert.equal(response.body.sessionId, platformSession.sessionId);
  assert.deepEqual(response.body.scope, { type: "platform" });
  assert.deepEqual(response.body.roleKeys, ["platform_admin"]);
  assert.ok(response.body.permissionKeys.includes("platform.tenants.provision"));
  assert.ok(response.body.permissionKeys.every((key: string) => key.startsWith("platform.")));
  assert.equal(response.body.userAuthorizationVersion, 1);
  assert.equal("membershipId" in response.body, false);
  assert.equal("membershipAuthorizationVersion" in response.body, false);
});

test("GET /auth/me/authorization returns only the active tenant membership authority", async () => {
  const response = await request(app.getHttpServer())
    .get("/api/auth/me/authorization")
    .set("host", tenantSession.hostname)
    .set("origin", `https://${tenantSession.hostname}`)
    .set("cookie", tenantSession.cookie)
    .expect(200);

  assertPrivateAuthorizationResponse(response);
  assert.equal(response.body.userId, TENANT_USER_ID);
  assert.equal(response.body.sessionId, tenantSession.sessionId);
  assert.deepEqual(response.body.scope, {
    type: "tenant",
    tenantId: TENANT_ID,
    tenantSlug: TENANT_SLUG,
  });
  assert.equal(response.body.membershipId, TENANT_MEMBERSHIP_ID);
  assert.equal(response.body.membershipStatus, "active");
  assert.deepEqual(response.body.roleKeys, ["tenant_owner"]);
  assert.ok(response.body.permissionKeys.includes("tenant.membership.read"));
  assert.ok(response.body.permissionKeys.every((key: string) => key.startsWith("tenant.")));
  assert.equal(response.body.userAuthorizationVersion, 1);
  assert.equal(response.body.membershipAuthorizationVersion, 1);
});
