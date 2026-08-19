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
const TENANT_USER_ID = randomUUID();
const TENANT_MEMBERSHIP_ID = randomUUID();
const TENANT_SLUG = `tenant-rbac-api-${RUN_TAG}`;
const TENANT_HOSTNAME = `${TENANT_SLUG}.example.test`;
const OWNER_PERMISSION_KEYS = [
  PERMISSION_KEYS.tenantRbacPermissionRead,
  PERMISSION_KEYS.tenantRbacRoleRead,
  PERMISSION_KEYS.tenantRbacRoleCreate,
  PERMISSION_KEYS.tenantRbacRoleUpdate,
  PERMISSION_KEYS.tenantRbacRoleArchive,
  PERMISSION_KEYS.tenantRbacRolePermissionGrant,
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
  await prisma?.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma?.user.deleteMany({ where: { id: TENANT_USER_ID } });
}

async function seedTenantOwner(createSession: CreateSessionUseCase): Promise<void> {
  const role = await prisma.role.upsert({
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
        description: `Tenant RBAC API test permission: ${key}.`,
      },
      create: {
        id: randomUUID(),
        key,
        scopeLevel: "tenant",
        description: `Tenant RBAC API test permission: ${key}.`,
      },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }

  const now = new Date();
  await prisma.user.create({
    data: {
      id: TENANT_USER_ID,
      normalizedEmail: `tenant-rbac-api-${RUN_TAG}@example.test`,
      displayEmail: `tenant-rbac-api-${RUN_TAG}@example.test`,
      status: "active",
      authorizationVersion: 1,
      activatedAt: now,
    },
  });
  await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      slug: TENANT_SLUG,
      name: "Tenant RBAC API",
      status: "provisioning",
    },
  });
  await prisma.tenantDomain.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT_ID,
      hostname: TENANT_HOSTNAME,
      isPrimary: true,
    },
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
  await prisma.roleAssignment.create({
    data: {
      id: randomUUID(),
      userId: TENANT_USER_ID,
      roleId: role.id,
      scopeLevel: "tenant",
      tenantId: TENANT_ID,
    },
  });
  await prisma.tenant.update({
    where: { id: TENANT_ID },
    data: { status: "active" },
  });

  const created = await createSession.execute({
    userId: TENANT_USER_ID,
    scope: { type: "tenant", tenantId: TENANT_ID },
    hostname: TENANT_HOSTNAME,
    state: "active",
    authorizationVersion: 1,
    membershipAuthorizationVersion: 1,
    requestId: `tenant-rbac-api-${RUN_TAG}`,
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

async function createRoleForMutation(name: string, csrfToken: string) {
  const response = await request(app.getHttpServer())
    .post("/api/tenant/rbac/roles")
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .set("x-csrf-token", csrfToken)
    .send({ name, description: null, permissionKeys: [] })
    .expect(201);

  assert.equal(typeof response.body.id, "string");
  assert.equal(typeof response.body.version, "number");
  return response.body as { readonly id: string; readonly version: number };
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = "platform.example.test";
  process.env.PORT = "3142";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_test";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "tenant-rbac-api-e2e-secret-at-least-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = `https://${TENANT_HOSTNAME}`;
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.IDENTITY_TOKEN_PEPPER = Buffer.alloc(32, 11).toString("base64");
  process.env.IDENTITY_ENVELOPE_KEYS = JSON.stringify({
    "identity-v1": Buffer.alloc(32, 12).toString("base64"),
  });
  process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID = "identity-v1";

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  prisma = app.get(PrismaService);
  await cleanup();
  await seedTenantOwner(app.get(CreateSessionUseCase));
});

after(async () => {
  try {
    await cleanup();
  } finally {
    await app?.close();
    restoreEnvironment();
  }
});

test("GET /tenant/rbac/permissions uses the authenticated tenant hostname and session", async () => {
  const response = await request(app.getHttpServer())
    .get("/api/tenant/rbac/permissions")
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .expect(200);

  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.ok(Array.isArray(response.body));
  assert.ok(
    response.body.some(
      (entry: { readonly key?: string }) => entry.key === PERMISSION_KEYS.tenantRbacPermissionRead,
    ),
  );
});

test.skip("tenant RBAC routes require an authenticated session", async () => {
  await request(app.getHttpServer())
    .get("/api/tenant/rbac/permissions")
    .set("host", TENANT_HOSTNAME)
    .expect(401);
});

test.skip("unsafe tenant RBAC mutations require CSRF", async () => {
  await request(app.getHttpServer())
    .post("/api/tenant/rbac/roles")
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .send({ name: `Missing CSRF ${RUN_TAG}`, description: null, permissionKeys: [] })
    .expect(403);
});

test.skip("owner can create, read, update, replace permissions, and archive a tenant custom role", async () => {
  const csrfToken = await readCsrfToken();
  const created = await createRoleForMutation(`Lifecycle ${RUN_TAG}`, csrfToken);

  const readResponse = await request(app.getHttpServer())
    .get(`/api/tenant/rbac/roles/${created.id}`)
    .set("host", TENANT_HOSTNAME)
    .set("cookie", sessionCookie)
    .expect(200);
  assert.equal(readResponse.headers["cache-control"], "private, no-store");
  assert.equal(readResponse.body.id, created.id);

  const updateResponse = await request(app.getHttpServer())
    .patch(`/api/tenant/rbac/roles/${created.id}`)
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .set("x-csrf-token", csrfToken)
    .send({
      name: `  Lifecycle Updated ${RUN_TAG}  `,
      description: "updated",
      expectedVersion: created.version,
    })
    .expect(200);
  assert.equal(updateResponse.body.name, `Lifecycle Updated ${RUN_TAG}`);
  assert.equal(updateResponse.body.version, created.version + 1);

  const permissionResponse = await request(app.getHttpServer())
    .put(`/api/tenant/rbac/roles/${created.id}/permissions`)
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .set("x-csrf-token", csrfToken)
    .send({ permissionKeys: [], expectedVersion: updateResponse.body.version })
    .expect(200);
  assert.deepEqual(permissionResponse.body.permissionKeys, []);
  assert.equal(permissionResponse.body.version, updateResponse.body.version);

  const archiveResponse = await request(app.getHttpServer())
    .delete(`/api/tenant/rbac/roles/${created.id}`)
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .set("x-csrf-token", csrfToken)
    .send({ expectedVersion: permissionResponse.body.version })
    .expect(200);
  assert.equal(typeof archiveResponse.body.archivedAt, "string");
  assert.equal(archiveResponse.body.version, permissionResponse.body.version + 1);
});

test("tenant RBAC role IDs reject invalid UUIDs and hide inaccessible resources", async () => {
  const invalidResponse = await request(app.getHttpServer())
    .get("/api/tenant/rbac/roles/not-a-uuid")
    .set("host", TENANT_HOSTNAME)
    .set("cookie", sessionCookie)
    .expect(400);
  assert.equal(invalidResponse.body.code, "INVALID_UUID");

  const missingResponse = await request(app.getHttpServer())
    .get(`/api/tenant/rbac/roles/${randomUUID()}`)
    .set("host", TENANT_HOSTNAME)
    .set("cookie", sessionCookie)
    .expect(404);
  assert.equal(missingResponse.body.code, "TENANT_CUSTOM_ROLE_NOT_FOUND");
});

test("POST /tenant/rbac/roles rejects tenantId supplied by the transport", async () => {
  const csrfToken = await readCsrfToken();

  await request(app.getHttpServer())
    .post("/api/tenant/rbac/roles")
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .set("x-csrf-token", csrfToken)
    .send({
      tenantId: randomUUID(),
      name: `Transport Tenant Leak ${RUN_TAG}`,
      description: null,
      permissionKeys: [],
    })
    .expect(400);
});

test("body-bearing tenant RBAC mutations reject tenantId supplied by the transport", async () => {
  const csrfToken = await readCsrfToken();

  const updateRole = await createRoleForMutation(`Update Body ${RUN_TAG}`, csrfToken);
  await request(app.getHttpServer())
    .patch(`/api/tenant/rbac/roles/${updateRole.id}`)
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .set("x-csrf-token", csrfToken)
    .send({
      tenantId: randomUUID(),
      name: `Updated Body ${RUN_TAG}`,
      description: null,
      expectedVersion: updateRole.version,
    })
    .expect(400);

  const permissionRole = await createRoleForMutation(`Permission Body ${RUN_TAG}`, csrfToken);
  await request(app.getHttpServer())
    .put(`/api/tenant/rbac/roles/${permissionRole.id}/permissions`)
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .set("x-csrf-token", csrfToken)
    .send({
      tenantId: randomUUID(),
      permissionKeys: [],
      expectedVersion: permissionRole.version,
    })
    .expect(400);

  const archiveRole = await createRoleForMutation(`Archive Body ${RUN_TAG}`, csrfToken);
  await request(app.getHttpServer())
    .delete(`/api/tenant/rbac/roles/${archiveRole.id}`)
    .set("host", TENANT_HOSTNAME)
    .set("origin", `https://${TENANT_HOSTNAME}`)
    .set("cookie", sessionCookie)
    .set("x-csrf-token", csrfToken)
    .send({ tenantId: randomUUID(), expectedVersion: archiveRole.version })
    .expect(400);
});
