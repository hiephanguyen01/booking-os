import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AcceptInvitationUseCase } from "../src/modules/memberships/application/use-cases/accept-invitation.use-case.js";
import { InvitationInvalidOrExpiredError } from "../src/modules/memberships/domain/membership-errors.js";
import { HmacMembershipInvitationTokenAdapter } from "../src/modules/memberships/infrastructure/crypto/hmac-membership-provisioning-token.adapter.js";
import { CreateSessionUseCase } from "../src/modules/sessions/application/use-cases/create-session.js";

const RUN_TAG = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const TENANT_SLUG = `pr26-accept-${RUN_TAG}`;
const HOSTNAME = `${TENANT_SLUG}.example.test`;
const INVITER_ID = randomUUID();
const INVITEE_ID = randomUUID();
const INVITATION_ID = randomUUID();
const MEMBERSHIP_ID = randomUUID();
const INVITER_EMAIL = `pr26-${RUN_TAG}-inviter@example.test`;
const INVITEE_EMAIL = `pr26-${RUN_TAG}-invitee@example.test`;
const TOKEN_PEPPER = Buffer.alloc(32, 1);
const ENVELOPE_KEY_ID = "identity-v1";
const ENVELOPE_KEY = Buffer.alloc(32, 2);

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
let acceptInvitation: AcceptInvitationUseCase;
let invitationToken: string;
let sessionId: string;

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function seed(): Promise<void> {
  const now = new Date();
  await prisma.role.upsert({
    where: { key: "tenant_admin" },
    update: { scopeLevel: "tenant", isSystem: true },
    create: { id: randomUUID(), key: "tenant_admin", scopeLevel: "tenant", isSystem: true },
  });
  await prisma.tenant.create({
    data: { id: TENANT_ID, slug: TENANT_SLUG, name: "PR26 Acceptance", status: "active" },
  });
  await prisma.tenantDomain.create({
    data: { id: randomUUID(), tenantId: TENANT_ID, hostname: HOSTNAME, isPrimary: true },
  });
  await prisma.user.createMany({
    data: [
      {
        id: INVITER_ID,
        normalizedEmail: INVITER_EMAIL,
        displayEmail: INVITER_EMAIL,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
      {
        id: INVITEE_ID,
        normalizedEmail: INVITEE_EMAIL,
        displayEmail: INVITEE_EMAIL,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
    ],
  });
  await prisma.tenantMembership.create({
    data: {
      id: MEMBERSHIP_ID,
      tenantId: TENANT_ID,
      userId: INVITEE_ID,
      status: "invited",
      authorizationVersion: 0,
    },
  });

  const tokens = new HmacMembershipInvitationTokenAdapter(TOKEN_PEPPER);
  const issued = tokens.issue({
    tenantId: TENANT_ID,
    userId: INVITEE_ID,
    hostname: HOSTNAME,
    normalizedEmail: INVITEE_EMAIL,
    intendedRoleKey: "tenant_admin",
  });
  invitationToken = issued.serialized;
  await prisma.membershipInvitation.create({
    data: {
      id: INVITATION_ID,
      tenantId: TENANT_ID,
      normalizedEmail: INVITEE_EMAIL,
      invitedUserId: INVITEE_ID,
      intendedRoleKey: "tenant_admin",
      status: "pending",
      hostname: HOSTNAME,
      selector: issued.selector,
      tokenHash: issued.tokenHash,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      invitedByUserId: INVITER_ID,
    },
  });

  const created = await createSession.execute({
    userId: INVITEE_ID,
    scope: { type: "tenant", tenantId: TENANT_ID },
    hostname: HOSTNAME,
    state: "invitation_pending",
    authorizationVersion: 0,
    requestId: `pr26-pending-session-${RUN_TAG}`,
  });
  sessionId = created.session.id;
}

async function cleanup(): Promise<void> {
  await prisma?.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma?.user.deleteMany({ where: { id: { in: [INVITER_ID, INVITEE_ID] } } });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = "platform.example.test";
  process.env.PORT = "3128";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_pr24_rls";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "invitation-concurrency-e2e-secret-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = `https://${HOSTNAME}`;
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.IDENTITY_TOKEN_PEPPER = TOKEN_PEPPER.toString("base64");
  process.env.IDENTITY_ENVELOPE_KEYS = JSON.stringify({
    [ENVELOPE_KEY_ID]: ENVELOPE_KEY.toString("base64"),
  });
  process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID = ENVELOPE_KEY_ID;

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  prisma = app.get(PrismaService);
  createSession = app.get(CreateSessionUseCase);
  acceptInvitation = app.get(AcceptInvitationUseCase);
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

test("two concurrent accepts produce exactly one activation and one rotated live token", async () => {
  const results = await Promise.allSettled([
    acceptInvitation.execute({
      tenantId: TENANT_ID,
      userId: INVITEE_ID,
      sessionId,
      hostname: HOSTNAME,
      token: invitationToken,
      requestId: `pr26-accept-a-${RUN_TAG}`,
    }),
    acceptInvitation.execute({
      tenantId: TENANT_ID,
      userId: INVITEE_ID,
      sessionId,
      hostname: HOSTNAME,
      token: invitationToken,
      requestId: `pr26-accept-b-${RUN_TAG}`,
    }),
  ]);

  const fulfilled = results.filter(
    (
      result,
    ): result is PromiseFulfilledResult<Awaited<ReturnType<AcceptInvitationUseCase["execute"]>>> =>
      result.status === "fulfilled",
  );
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0]?.reason instanceof InvitationInvalidOrExpiredError);
  assert.equal(fulfilled[0]?.value.accepted, true);

  const invitation = await prisma.membershipInvitation.findUniqueOrThrow({
    where: { id: INVITATION_ID },
  });
  const membership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { id: MEMBERSHIP_ID },
  });
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } });
  const sessionTokens = await prisma.authSessionToken.findMany({ where: { sessionId } });
  const assignments = await prisma.roleAssignment.findMany({
    where: { userId: INVITEE_ID, tenantId: TENANT_ID },
    include: { role: true },
  });

  assert.equal(invitation.status, "accepted");
  assert.notEqual(invitation.acceptedAt, null);
  assert.equal(membership.status, "active");
  assert.equal(membership.authorizationVersion, 1);
  assert.equal(session.state, "active");
  assert.equal(session.authorizationVersion, 1);
  assert.equal(
    assignments.filter((assignment) => assignment.role.key === "tenant_admin").length,
    1,
  );
  assert.equal(sessionTokens.filter((token) => token.revokedAt === null).length, 1);
  assert.equal(sessionTokens.filter((token) => token.revokedAt !== null).length, 1);
  assert.equal(sessionTokens.length, 2);
});
