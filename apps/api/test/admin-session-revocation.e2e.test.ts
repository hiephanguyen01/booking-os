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
const WRONG_HOSTNAME = "platform.invalid.test";
const WRONG_ORIGIN = `https://${WRONG_HOSTNAME}`;
const ADMIN_USER_ID = randomUUID();
const DENIED_USER_ID = randomUUID();
const TARGET_USER_ID = randomUUID();
const REASON = "suspected_account_compromise";

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
  readonly csrfToken: string;
  readonly sessionId: string;
  readonly hostname: string;
  readonly origin: string;
}

let app: INestApplication;
let prisma: PrismaService;
let createSession: CreateSessionUseCase;
let adminSession: SessionFixture;
let deniedSession: SessionFixture;
let wrongHostSession: SessionFixture;
let targetSessionIds: readonly string[];

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function cleanup(): Promise<void> {
  await prisma?.user.deleteMany({
    where: { id: { in: [ADMIN_USER_ID, DENIED_USER_ID, TARGET_USER_ID] } },
  });
}

async function ensureCatalog(): Promise<string> {
  const platformAdmin = await prisma.role.upsert({
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
    where: { roleId_permissionId: { roleId: platformAdmin.id, permissionId: permission.id } },
    update: {},
    create: { roleId: platformAdmin.id, permissionId: permission.id },
  });
  return platformAdmin.id;
}

async function sessionFixture(
  userId: string,
  hostname = PLATFORM_HOSTNAME,
  origin = PLATFORM_ORIGIN,
): Promise<SessionFixture> {
  const created = await createSession.execute({
    userId,
    scope: { type: "platform" },
    hostname,
    state: "active",
    authorizationVersion: 1,
    requestId: `admin-revoke-session-${randomUUID()}`,
  });
  const cookie = `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(created.token)}`;
  const csrf = await request(app.getHttpServer())
    .get("/api/auth/session/csrf")
    .set("host", hostname)
    .set("cookie", cookie)
    .expect(200);
  assert.equal(typeof csrf.body.csrfToken, "string");
  return {
    cookie,
    csrfToken: csrf.body.csrfToken as string,
    sessionId: created.session.id,
    hostname,
    origin,
  };
}

function revokeRequest(session: SessionFixture, userId: string = TARGET_USER_ID) {
  return request(app.getHttpServer())
    .post(`/api/platform/security/users/${userId}/sessions/revoke`)
    .set("host", session.hostname)
    .set("origin", session.origin)
    .set("cookie", session.cookie)
    .set("x-csrf-token", session.csrfToken)
    .send({ reason: REASON });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = PLATFORM_HOSTNAME;
  process.env.PORT = "3135";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_pr24_rls";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "admin-session-revocation-e2e-secret-at-least-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = `${PLATFORM_ORIGIN},${WRONG_ORIGIN}`;
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.IDENTITY_TOKEN_PEPPER = Buffer.alloc(32, 9).toString("base64");
  process.env.IDENTITY_ENVELOPE_KEYS = JSON.stringify({
    "identity-v1": Buffer.alloc(32, 10).toString("base64"),
  });
  process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID = "identity-v1";

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  prisma = app.get(PrismaService);
  createSession = app.get(CreateSessionUseCase);
  await cleanup();

  const platformAdminRoleId = await ensureCatalog();
  const now = new Date();
  await prisma.user.createMany({
    data: [
      {
        id: ADMIN_USER_ID,
        normalizedEmail: `admin-revoke-${RUN_TAG}@example.test`,
        displayEmail: `admin-revoke-${RUN_TAG}@example.test`,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
      {
        id: DENIED_USER_ID,
        normalizedEmail: `admin-revoke-denied-${RUN_TAG}@example.test`,
        displayEmail: `admin-revoke-denied-${RUN_TAG}@example.test`,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
      {
        id: TARGET_USER_ID,
        normalizedEmail: `admin-revoke-target-${RUN_TAG}@example.test`,
        displayEmail: `admin-revoke-target-${RUN_TAG}@example.test`,
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

  adminSession = await sessionFixture(ADMIN_USER_ID);
  deniedSession = await sessionFixture(DENIED_USER_ID);
  wrongHostSession = await sessionFixture(ADMIN_USER_ID, WRONG_HOSTNAME, WRONG_ORIGIN);
  const targetOne = await sessionFixture(TARGET_USER_ID);
  const targetTwo = await sessionFixture(TARGET_USER_ID);
  targetSessionIds = [targetOne.sessionId, targetTwo.sessionId];
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

test("platform incident revocation requires session, CSRF, permission, exact host, and valid input", async () => {
  await request(app.getHttpServer())
    .post(`/api/platform/security/users/${TARGET_USER_ID}/sessions/revoke`)
    .set("host", PLATFORM_HOSTNAME)
    .set("origin", PLATFORM_ORIGIN)
    .send({ reason: REASON })
    .expect(401);

  await request(app.getHttpServer())
    .post(`/api/platform/security/users/${TARGET_USER_ID}/sessions/revoke`)
    .set("host", PLATFORM_HOSTNAME)
    .set("origin", PLATFORM_ORIGIN)
    .set("cookie", adminSession.cookie)
    .send({ reason: REASON })
    .expect(403);

  await revokeRequest(deniedSession).expect(403);
  await revokeRequest(wrongHostSession).expect(404);
  await revokeRequest(adminSession, "not-a-uuid").expect(400);

  await request(app.getHttpServer())
    .post(`/api/platform/security/users/${TARGET_USER_ID}/sessions/revoke`)
    .set("host", PLATFORM_HOSTNAME)
    .set("origin", PLATFORM_ORIGIN)
    .set("cookie", adminSession.cookie)
    .set("x-csrf-token", adminSession.csrfToken)
    .send({ reason: "" })
    .expect(400);
});

test("platform incident revocation revokes every target session and token without revoking the actor", async () => {
  const response = await revokeRequest(adminSession).expect(200);
  assert.deepEqual(response.body, {
    userId: TARGET_USER_ID,
    revokedSessionCount: 2,
  });

  const targetSessions = await prisma.authSession.findMany({
    where: { id: { in: [...targetSessionIds] } },
    orderBy: { id: "asc" },
  });
  assert.equal(targetSessions.length, 2);
  assert.ok(targetSessions.every((session) => session.state === "revoked"));
  assert.ok(targetSessions.every((session) => session.revokedAt !== null));
  assert.ok(
    targetSessions.every((session) => session.revocationReason === `platform_incident:${REASON}`),
  );

  const targetTokens = await prisma.authSessionToken.findMany({
    where: { sessionId: { in: [...targetSessionIds] } },
  });
  assert.ok(targetTokens.length >= 2);
  assert.ok(targetTokens.every((token) => token.revokedAt !== null));

  const actorSession = await prisma.authSession.findUniqueOrThrow({
    where: { id: adminSession.sessionId },
  });
  assert.equal(actorSession.state, "active");
  assert.equal(actorSession.revokedAt, null);
});
