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
const PLATFORM_ORIGIN = `https://${PLATFORM_HOSTNAME}`;
const ADMIN_USER_ID = randomUUID();
const TARGET_USER_ID = randomUUID();
const REQUEST_ID = `security-audit-${RUN_TAG}`;
const RAW_REASON = "suspected_account_compromise";
const ADMIN_EMAIL = `security-audit-admin-${RUN_TAG}@example.test`;
const TARGET_EMAIL = `security-audit-target-${RUN_TAG}@example.test`;

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
let createSession: CreateSessionUseCase;
let adminCookie: string;
let adminCsrfToken: string;
let adminRawToken: string;
let targetSessionId: string;
let targetRawToken: string;

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function cleanup(): Promise<void> {
  await prisma?.securityAuditEvent.deleteMany({ where: { requestId: REQUEST_ID } });
  await prisma?.user.deleteMany({ where: { id: { in: [ADMIN_USER_ID, TARGET_USER_ID] } } });
}

async function ensurePlatformAdminCatalog(): Promise<string> {
  const role = await prisma.role.upsert({
    where: { key: "platform_admin" },
    update: { scopeLevel: "platform", isSystem: true },
    create: { id: randomUUID(), key: "platform_admin", scopeLevel: "platform", isSystem: true },
  });
  const permission = await prisma.permission.upsert({
    where: { key: "platform.security.session.revoke" },
    update: {
      scopeLevel: "platform",
      description: "Revoke all sessions for a user during a platform security incident.",
    },
    create: {
      id: randomUUID(),
      key: "platform.security.session.revoke",
      scopeLevel: "platform",
      description: "Revoke all sessions for a user during a platform security incident.",
    },
  });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    update: {},
    create: { roleId: role.id, permissionId: permission.id },
  });
  return role.id;
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = PLATFORM_HOSTNAME;
  process.env.PORT = "3136";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_pr24_rls";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "security-audit-e2e-secret-at-least-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = PLATFORM_ORIGIN;
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
  createSession = app.get(CreateSessionUseCase);
  await cleanup();

  const platformAdminRoleId = await ensurePlatformAdminCatalog();
  const now = new Date();
  await prisma.user.createMany({
    data: [
      {
        id: ADMIN_USER_ID,
        normalizedEmail: ADMIN_EMAIL,
        displayEmail: ADMIN_EMAIL,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
      {
        id: TARGET_USER_ID,
        normalizedEmail: TARGET_EMAIL,
        displayEmail: TARGET_EMAIL,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
    ],
  });
  await prisma.roleAssignment.create({
    data: {
      id: randomUUID(),
      userId: ADMIN_USER_ID,
      roleId: platformAdminRoleId,
      scopeLevel: "platform",
      tenantId: null,
    },
  });

  const adminSession = await createSession.execute({
    userId: ADMIN_USER_ID,
    scope: { type: "platform" },
    hostname: PLATFORM_HOSTNAME,
    state: "active",
    authorizationVersion: 1,
    requestId: `fixture-admin-${RUN_TAG}`,
  });
  adminRawToken = adminSession.token;
  adminCookie = `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(adminSession.token)}`;
  const csrf = await request(app.getHttpServer())
    .get("/api/auth/session/csrf")
    .set("host", PLATFORM_HOSTNAME)
    .set("cookie", adminCookie)
    .expect(200);
  adminCsrfToken = csrf.body.csrfToken as string;

  const targetSession = await createSession.execute({
    userId: TARGET_USER_ID,
    scope: { type: "platform" },
    hostname: PLATFORM_HOSTNAME,
    state: "active",
    authorizationVersion: 1,
    requestId: `fixture-target-${RUN_TAG}`,
  });
  targetSessionId = targetSession.session.id;
  targetRawToken = targetSession.token;
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

test("security-state mutation persists bounded audit metadata in the same successful operation", async () => {
  const response = await request(app.getHttpServer())
    .post(`/api/platform/security/users/${TARGET_USER_ID}/sessions/revoke`)
    .set("host", PLATFORM_HOSTNAME)
    .set("origin", PLATFORM_ORIGIN)
    .set("cookie", adminCookie)
    .set("x-csrf-token", adminCsrfToken)
    .set("x-request-id", REQUEST_ID)
    .send({ reason: RAW_REASON })
    .expect(200);

  assert.deepEqual(response.body, { userId: TARGET_USER_ID, revokedSessionCount: 1 });

  const storedSession = await prisma.authSession.findUniqueOrThrow({ where: { id: targetSessionId } });
  assert.equal(storedSession.state, "revoked");
  assert.equal(storedSession.revocationReason, `platform_incident:${RAW_REASON}`);

  const audit = await prisma.securityAuditEvent.findFirstOrThrow({
    where: { eventType: "session.revoked", requestId: REQUEST_ID },
  });
  assert.equal(audit.actorUserId, ADMIN_USER_ID);
  assert.equal(audit.subjectUserId, TARGET_USER_ID);
  assert.equal(audit.requestId, REQUEST_ID);
  assert.deepEqual(audit.metadata, {
    action: "revoke_all",
    result: "success",
    reason: "security_incident",
    hostname: PLATFORM_HOSTNAME,
    scopeType: "platform",
    revokedSessionCount: 1,
  });

  const serializedAudit = JSON.stringify(audit);
  for (const sensitive of [
    RAW_REASON,
    ADMIN_EMAIL,
    TARGET_EMAIL,
    adminRawToken,
    targetRawToken,
    BOOKING_SESSION_COOKIE,
  ]) {
    assert.equal(serializedAudit.includes(sensitive), false, `audit leaked ${sensitive}`);
  }
});
