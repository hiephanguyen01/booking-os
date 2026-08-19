import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { BOOKING_SESSION_COOKIE, PERMISSION_KEYS } from "@booking-os/auth";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { CreateSessionUseCase } from "../src/modules/sessions/application/use-cases/create-session.js";

const RUN_TAG = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();
const OWNER_USER_ID = randomUUID();
const OTHER_USER_ID = randomUUID();
const OWNER_MEMBERSHIP_ID = randomUUID();
const OTHER_MEMBERSHIP_ID = randomUUID();
const CURRENT_ROLE_ID = randomUUID();
const OTHER_ROLE_ID = randomUUID();
const TENANT_SLUG = `tenant-rbac-isolation-${RUN_TAG}`;
const TENANT_HOSTNAME = `${TENANT_SLUG}.example.test`;

const OWNER_PERMISSION_KEYS = [
  PERMISSION_KEYS.tenantRbacRoleRead,
  PERMISSION_KEYS.tenantRbacAssignmentRead,
  PERMISSION_KEYS.tenantRbacAssignmentGrant,
] as const;

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
let sessionCookie = "";

function restoreEnvironment(): void {
  for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function cleanup(): Promise<void> {
  await prisma?.tenant.deleteMany({ where: { id: { in: [TENANT_ID, OTHER_TENANT_ID] } } });
  await prisma?.user.deleteMany({ where: { id: { in: [OWNER_USER_ID, OTHER_USER_ID] } } });
}

async function seed(createSession: CreateSessionUseCase): Promise<void> {
  const ownerRole = await prisma.role.upsert({
    where: { key: "tenant_owner" },
    update: { scopeLevel: "tenant", isSystem: true },
    create: {
      id: randomUUID(),
      key: "tenant_owner",
      scopeLevel: "tenant",
      isSystem: true,
    },
  });

  for (const key of OWNER_PERMISSION_KEYS) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: {
        scopeLevel: "tenant",
        description: `Tenant RBAC isolation permission: ${key}.`,
      },
      create: {
        id: randomUUID(),
        key,
        scopeLevel: "tenant",
        description: `Tenant RBAC isolation permission: ${key}.`,
      },
    });
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: ownerRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: { roleId: ownerRole.id, permissionId: permission.id },
    });
  }

  const now = new Date();
  await prisma.user.createMany({
    data: [
      {
        id: OWNER_USER_ID,
        normalizedEmail: `tenant-rbac-isolation-owner-${RUN_TAG}@example.test`,
        displayEmail: `tenant-rbac-isolation-owner-${RUN_TAG}@example.test`,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
      {
        id: OTHER_USER_ID,
        normalizedEmail: `tenant-rbac-isolation-other-${RUN_TAG}@example.test`,
        displayEmail: `tenant-rbac-isolation-other-${RUN_TAG}@example.test`,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
    ],
  });

  await prisma.tenant.createMany({
    data: [
      {
        id: TENANT_ID,
        slug: TENANT_SLUG,
        name: "Tenant RBAC Isolation",
        status: "provisioning",
      },
      {
        id: OTHER_TENANT_ID,
        slug: `tenant-rbac-isolation-other-${RUN_TAG}`,
        name: "Tenant RBAC Isolation Other",
        status: "provisioning",
      },
    ],
  });

  await prisma.tenantDomain.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT_ID,
      hostname: TENANT_HOSTNAME,
      isPrimary: true,
    },
  });

  await prisma.tenantMembership.createMany({
    data: [
      {
        id: OWNER_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: OWNER_USER_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: now,
      },
      {
        id: OTHER_MEMBERSHIP_ID,
        tenantId: OTHER_TENANT_ID,
        userId: OTHER_USER_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: now,
      },
    ],
  });

  await prisma.roleAssignment.create({
    data: {
      id: randomUUID(),
      userId: OWNER_USER_ID,
      roleId: ownerRole.id,
      scopeLevel: "tenant",
      tenantId: TENANT_ID,
    },
  });

  await prisma.$executeRaw`
    INSERT INTO "tenant_custom_roles" (
      "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
    ) VALUES
      (
        ${CURRENT_ROLE_ID}::uuid, ${TENANT_ID}::uuid,
        'Current Tenant Role', ${`current tenant role ${RUN_TAG}`}, 1,
        ${now}::timestamptz, ${now}::timestamptz
      ),
      (
        ${OTHER_ROLE_ID}::uuid, ${OTHER_TENANT_ID}::uuid,
        'Other Tenant Role', ${`other tenant role ${RUN_TAG}`}, 1,
        ${now}::timestamptz, ${now}::timestamptz
      )
  `;

  await prisma.tenant.updateMany({
    where: { id: { in: [TENANT_ID, OTHER_TENANT_ID] } },
    data: { status: "active" },
  });

  const created = await createSession.execute({
    userId: OWNER_USER_ID,
    scope: { type: "tenant", tenantId: TENANT_ID },
    hostname: TENANT_HOSTNAME,
    state: "active",
    authorizationVersion: 1,
    membershipAuthorizationVersion: 1,
    requestId: `tenant-rbac-isolation-${RUN_TAG}`,
  });
  sessionCookie = `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(created.token)}`;
}

async function readCsrfToken(): Promise<string> {
  const response = await request(app.getHttpServer())
    .get("/api/auth/session/csrf")
    .set("host", TENANT_HOSTNAME)
    .set("cookie", sessionCookie)
    .expect(200);
  assert.equal(typeof response.body.csrfToken, "string");
  return response.body.csrfToken as string;
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = "platform.example.test";
  process.env.PORT = "3143";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_test";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "tenant-rbac-isolation-secret-at-least-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = `https://${TENANT_HOSTNAME}`;
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.IDENTITY_TOKEN_PEPPER = Buffer.alloc(32, 13).toString("base64");
  process.env.IDENTITY_ENVELOPE_KEYS = JSON.stringify({
    "identity-v1": Buffer.alloc(32, 14).toString("base64"),
  });
  process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID = "identity-v1";

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  prisma = app.get(PrismaService);
  await cleanup();
  await seed(app.get(CreateSessionUseCase));
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await app?.close();
    restoreEnvironment();
  }
});

test("foreign Tenant RBAC role IDs remain hidden from the current tenant", async () => {
  const currentRole = await request(app.getHttpServer())
    .get(`/api/tenant/rbac/roles/${CURRENT_ROLE_ID}`)
    .set("host", TENANT_HOSTNAME)
    .set("cookie", sessionCookie)
    .expect(200);
  assert.equal(currentRole.body.id, CURRENT_ROLE_ID);

  const foreignRole = await request(app.getHttpServer())
    .get(`/api/tenant/rbac/roles/${OTHER_ROLE_ID}`)
    .set("host", TENANT_HOSTNAME)
    .set("cookie", sessionCookie)
    .expect(404);
  assert.equal(foreignRole.body.code, "TENANT_CUSTOM_ROLE_NOT_FOUND");
});

test.skip("foreign Tenant RBAC membership IDs remain hidden from the current tenant", async () => {
  const currentMembership = await request(app.getHttpServer())
    .get(`/api/tenant/rbac/memberships/${OWNER_MEMBERSHIP_ID}/roles`)
    .set("host", TENANT_HOSTNAME)
    .set("cookie", sessionCookie)
    .expect(200);
  assert.ok(Array.isArray(currentMembership.body));

  const foreignMembership = await request(app.getHttpServer())
    .get(`/api/tenant/rbac/memberships/${OTHER_MEMBERSHIP_ID}/roles`)
    .set("host", TENANT_HOSTNAME)
    .set("cookie", sessionCookie)
    .expect(404);
  assert.equal(foreignMembership.body.code, "MEMBERSHIP_REQUIRED");

  const csrfToken = await readCsrfToken();
  const foreignAssignment = await request(app.getHttpServer())
    .post(`/api/tenant/rbac/memberships/${OTHER_MEMBERSHIP_ID}/roles/${CURRENT_ROLE_ID}`)
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .set("x-csrf-token", csrfToken)
    .expect(404);
  assert.equal(foreignAssignment.body.code, "MEMBERSHIP_REQUIRED");
});
