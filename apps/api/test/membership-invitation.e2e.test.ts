import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import {
  BOOKING_SESSION_COOKIE,
  decryptSensitiveEnvelope,
  type SensitiveEnvelope,
} from "@booking-os/auth";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { CreateSessionUseCase } from "../src/modules/sessions/application/use-cases/create-session.js";

const RUN_TAG = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const TENANT_SLUG = `pr26-invite-${RUN_TAG}`;
const HOSTNAME = `${TENANT_SLUG}.example.test`;
const ORIGIN = `https://${HOSTNAME}`;
const OWNER_ID = randomUUID();
const EXISTING_ID = randomUUID();
const OWNER_EMAIL = `pr26-${RUN_TAG}-owner@example.test`;
const EXISTING_EMAIL = `pr26-${RUN_TAG}-existing@example.test`;
const PENDING_EMAIL = `pr26-${RUN_TAG}-pending@example.test`;
const DUPLICATE_EMAIL = `pr26-${RUN_TAG}-duplicate@example.test`;
const KEY_ID = "identity-v1";
const KEY = Buffer.alloc(32, 2);

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
}

let app: INestApplication;
let prisma: PrismaService;
let createSession: CreateSessionUseCase;
let ownerSession: SessionFixture;

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function ensureCatalog(): Promise<{ readonly ownerRoleId: string }> {
  const ownerRole = await prisma.role.upsert({
    where: { key: "tenant_owner" },
    update: { scopeLevel: "tenant", isSystem: true },
    create: { id: randomUUID(), key: "tenant_owner", scopeLevel: "tenant", isSystem: true },
  });
  const adminRole = await prisma.role.upsert({
    where: { key: "tenant_admin" },
    update: { scopeLevel: "tenant", isSystem: true },
    create: { id: randomUUID(), key: "tenant_admin", scopeLevel: "tenant", isSystem: true },
  });
  const permission = await prisma.permission.upsert({
    where: { key: "tenant.membership.admin.invite" },
    update: { scopeLevel: "tenant", description: "Invite tenant administrators." },
    create: {
      id: randomUUID(),
      key: "tenant.membership.admin.invite",
      scopeLevel: "tenant",
      description: "Invite tenant administrators.",
    },
  });
  for (const roleId of [ownerRole.id, adminRole.id]) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      update: {},
      create: { roleId, permissionId: permission.id },
    });
  }
  return { ownerRoleId: ownerRole.id };
}

async function seedTenant(): Promise<void> {
  const { ownerRoleId } = await ensureCatalog();
  const now = new Date();
  await prisma.tenant.create({
    data: { id: TENANT_ID, slug: TENANT_SLUG, name: "PR26 Invitations", status: "provisioning" },
  });
  await prisma.tenantDomain.create({
    data: { id: randomUUID(), tenantId: TENANT_ID, hostname: HOSTNAME, isPrimary: true },
  });
  await prisma.user.createMany({
    data: [
      {
        id: OWNER_ID,
        normalizedEmail: OWNER_EMAIL,
        displayEmail: OWNER_EMAIL,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
      {
        id: EXISTING_ID,
        normalizedEmail: EXISTING_EMAIL,
        displayEmail: EXISTING_EMAIL,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
    ],
  });
  await prisma.tenantMembership.create({
    data: {
      id: randomUUID(),
      tenantId: TENANT_ID,
      userId: OWNER_ID,
      status: "active",
      authorizationVersion: 1,
      acceptedAt: now,
    },
  });
  await prisma.roleAssignment.create({
    data: {
      id: randomUUID(),
      userId: OWNER_ID,
      roleId: ownerRoleId,
      scopeLevel: "tenant",
      tenantId: TENANT_ID,
    },
  });
  await prisma.tenant.update({ where: { id: TENANT_ID }, data: { status: "active" } });
}

async function createOwnerSession(): Promise<SessionFixture> {
  const created = await createSession.execute({
    userId: OWNER_ID,
    scope: { type: "tenant", tenantId: TENANT_ID },
    hostname: HOSTNAME,
    state: "active",
    authorizationVersion: 1,
    membershipAuthorizationVersion: 1,
    requestId: `pr26-session-${RUN_TAG}`,
  });
  const cookie = `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(created.token)}`;
  const csrf = await request(app.getHttpServer())
    .get("/api/auth/session/csrf")
    .set("host", HOSTNAME)
    .set("cookie", cookie)
    .expect(200);
  assert.equal(typeof csrf.body.csrfToken, "string");
  return { cookie, csrfToken: csrf.body.csrfToken as string };
}

function authenticatedPost(path: string, body?: Readonly<Record<string, unknown>>) {
  const call = request(app.getHttpServer())
    .post(path)
    .set("host", HOSTNAME)
    .set("origin", ORIGIN)
    .set("cookie", ownerSession.cookie)
    .set("x-csrf-token", ownerSession.csrfToken);
  return body ? call.send(body) : call;
}

function requireEnvelope(payload: unknown): SensitiveEnvelope {
  assert.equal(typeof payload, "object");
  assert.notEqual(payload, null);
  const record = payload as Readonly<Record<string, unknown>>;
  assert.doesNotMatch(JSON.stringify(record), /rawToken|serializedToken|tokenHash|secret/iu);
  assert.equal(typeof record.envelope, "object");
  return record.envelope as SensitiveEnvelope;
}

function decryptInvitationToken(event: {
  readonly id: string;
  readonly tenantId: string | null;
  readonly aggregateId: string;
  readonly payload: unknown;
}): string {
  const payload = event.payload as Readonly<Record<string, unknown>>;
  const recipient = payload.recipient as string;
  const hostname = payload.hostname as string;
  const userId = payload.userId as string;
  const intendedRoleKey = payload.intendedRoleKey as string;
  const plaintext = decryptSensitiveEnvelope({
    envelope: requireEnvelope(payload),
    keyring: { [KEY_ID]: KEY },
    aad: new TextEncoder().encode(
      [
        "booking-os:membership-email:v1",
        "membership.admin_invitation.requested.v1",
        event.id,
        event.tenantId,
        event.aggregateId,
        userId,
        hostname,
        recipient,
        intendedRoleKey,
      ].join("\0"),
    ),
  });
  const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as { token: string };
  assert.equal(JSON.stringify(payload).includes(decoded.token), false);
  return decoded.token;
}

async function cleanup(): Promise<void> {
  await prisma?.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma?.user.deleteMany({
    where: { normalizedEmail: { startsWith: `pr26-${RUN_TAG}-` } },
  });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = "platform.example.test";
  process.env.PORT = "3126";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_pr24_rls";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "tenant-invitation-e2e-secret-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = ORIGIN;
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.IDENTITY_TOKEN_PEPPER = Buffer.alloc(32, 1).toString("base64");
  process.env.IDENTITY_ENVELOPE_KEYS = JSON.stringify({ [KEY_ID]: KEY.toString("base64") });
  process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID = KEY_ID;

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  prisma = app.get(PrismaService);
  createSession = app.get(CreateSessionUseCase);
  await cleanup();
  await seedTenant();
  ownerSession = await createOwnerSession();
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

test("tenant admin invitations reuse identities, issue activation when needed, encrypt tokens, and resend by replacement", async () => {
  await authenticatedPost("/api/membership/invitations", { email: EXISTING_EMAIL }).expect(202, {
    accepted: true,
  });

  const existingMembership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { tenantId_userId: { tenantId: TENANT_ID, userId: EXISTING_ID } },
  });
  assert.equal(existingMembership.status, "invited");
  const existingInvitation = await prisma.membershipInvitation.findFirstOrThrow({
    where: { tenantId: TENANT_ID, invitedUserId: EXISTING_ID, status: "pending" },
  });
  assert.equal(existingInvitation.intendedRoleKey, "tenant_admin");
  assert.equal(existingInvitation.hostname, HOSTNAME);
  assert.ok(
    existingInvitation.expiresAt.getTime() - existingInvitation.createdAt.getTime() >= 86_399_000,
  );
  assert.ok(
    existingInvitation.expiresAt.getTime() - existingInvitation.createdAt.getTime() <= 86_401_000,
  );
  assert.equal(await prisma.accountActivationToken.count({ where: { userId: EXISTING_ID } }), 0);

  const existingEvent = await prisma.outboxEvent.findFirstOrThrow({
    where: { aggregateId: existingInvitation.id, type: "membership.admin_invitation.requested.v1" },
  });
  const existingToken = decryptInvitationToken(existingEvent);
  assert.ok(existingToken.startsWith(`${existingInvitation.selector}.`));

  await authenticatedPost("/api/membership/invitations", { email: PENDING_EMAIL }).expect(202, {
    accepted: true,
  });
  const pendingUser = await prisma.user.findUniqueOrThrow({
    where: { normalizedEmail: PENDING_EMAIL },
  });
  assert.equal(pendingUser.status, "pendingActivation");
  const pendingInvitation = await prisma.membershipInvitation.findFirstOrThrow({
    where: { tenantId: TENANT_ID, invitedUserId: pendingUser.id, status: "pending" },
  });
  const activation = await prisma.accountActivationToken.findFirstOrThrow({
    where: { userId: pendingUser.id, tenantId: TENANT_ID, invitationId: pendingInvitation.id },
  });
  assert.equal(activation.hostname, HOSTNAME);
  assert.notEqual(activation.selector, pendingInvitation.selector);

  await authenticatedPost(`/api/membership/invitations/${pendingInvitation.id}/resend`).expect(
    202,
    { accepted: true },
  );
  const invitationsAfterResend = await prisma.membershipInvitation.findMany({
    where: { tenantId: TENANT_ID, invitedUserId: pendingUser.id },
  });
  assert.equal(invitationsAfterResend.length, 2);
  assert.equal(invitationsAfterResend.filter(({ status }) => status === "revoked").length, 1);
  assert.equal(invitationsAfterResend.filter(({ status }) => status === "pending").length, 1);

  const activationsAfterResend = await prisma.accountActivationToken.findMany({
    where: { userId: pendingUser.id, tenantId: TENANT_ID },
  });
  assert.equal(activationsAfterResend.length, 2);
  assert.equal(activationsAfterResend.filter(({ revokedAt }) => revokedAt !== null).length, 1);
  assert.equal(activationsAfterResend.filter(({ revokedAt }) => revokedAt === null).length, 1);
});

test("duplicate concurrent invitations produce one pending membership/invitation and no token leakage", async () => {
  const responses = await Promise.all([
    authenticatedPost("/api/membership/invitations", { email: DUPLICATE_EMAIL }),
    authenticatedPost("/api/membership/invitations", { email: DUPLICATE_EMAIL }),
  ]);
  assert.deepEqual(
    responses.map(({ status, body }) => ({ status, body })),
    [
      { status: 202, body: { accepted: true } },
      { status: 202, body: { accepted: true } },
    ],
  );

  const user = await prisma.user.findUniqueOrThrow({
    where: { normalizedEmail: DUPLICATE_EMAIL },
  });
  assert.equal(
    await prisma.tenantMembership.count({ where: { tenantId: TENANT_ID, userId: user.id } }),
    1,
  );
  assert.equal(
    await prisma.membershipInvitation.count({
      where: { tenantId: TENANT_ID, invitedUserId: user.id, status: "pending" },
    }),
    1,
  );
  const events = await prisma.outboxEvent.findMany({
    where: { tenantId: TENANT_ID, type: "membership.admin_invitation.requested.v1" },
  });
  for (const event of events) {
    assert.doesNotMatch(
      JSON.stringify(event.payload),
      /rawToken|serializedToken|tokenHash|secret/iu,
    );
  }
});
