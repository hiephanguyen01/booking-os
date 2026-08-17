import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import {
  BOOKING_SESSION_COOKIE,
  createSessionToken,
  decryptSensitiveEnvelope,
  type SensitiveEnvelope,
} from "@booking-os/auth";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { CreateSessionUseCase } from "../src/modules/sessions/application/use-cases/create-session.js";

const PLATFORM_HOSTNAME = "platform.example.test";
const PLATFORM_ORIGIN = `https://${PLATFORM_HOSTNAME}`;
const INCORRECT_PLATFORM_HOSTNAME = "platform.invalid.test";
const INCORRECT_PLATFORM_ORIGIN = `https://${INCORRECT_PLATFORM_HOSTNAME}`;
const FIXTURE_EMAIL_PREFIX = "pr24-platform-e2e-";
const FIXTURE_SLUG_PREFIX = "pr24e2e-";
const IDEMPOTENCY_KEY_PREFIX = "pr24-platform-e2e-";
const RUN_TAG = randomUUID().slice(0, 8);
const RUN_EMAIL_PREFIX = `${FIXTURE_EMAIL_PREFIX}${RUN_TAG}`;
const RUN_SLUG_PREFIX = `${FIXTURE_SLUG_PREFIX}${RUN_TAG}`;
const RUN_IDEMPOTENCY_KEY_PREFIX = `${IDEMPOTENCY_KEY_PREFIX}${RUN_TAG}`;
const ENVELOPE_KEY_ID = "identity-v1";
const ENVELOPE_KEY = Buffer.alloc(32, 2);

const ADMIN_USER_ID = randomUUID();
const DENIED_USER_ID = randomUUID();
const EXISTING_OWNER_USER_ID = randomUUID();
const ADMIN_EMAIL = `${RUN_EMAIL_PREFIX}-admin@example.test`;
const DENIED_EMAIL = `${RUN_EMAIL_PREFIX}-denied@example.test`;
const EXISTING_OWNER_EMAIL = `${RUN_EMAIL_PREFIX}-existing@example.test`;
const PENDING_OWNER_EMAIL = `${RUN_EMAIL_PREFIX}-pending@example.test`;

const existingOwnerBody = Object.freeze({
  slug: `${RUN_SLUG_PREFIX}-existing`,
  tenantName: "PR24 Existing Owner Tenant",
  ownerEmail: EXISTING_OWNER_EMAIL,
});
const pendingOwnerBody = Object.freeze({
  slug: `${RUN_SLUG_PREFIX}-pending`,
  tenantName: "PR24 Pending Owner Tenant",
  ownerEmail: PENDING_OWNER_EMAIL,
});

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

interface ProvisioningResponse {
  readonly tenantId: string;
  readonly slug: string;
  readonly status: "provisioning";
  readonly ownerMembershipId: string;
  readonly ownerInvitationId: string;
  readonly replayed?: boolean;
}

interface SessionFixture {
  readonly cookie: string;
  readonly csrfToken: string;
  readonly hostname: string;
  readonly origin: string;
}

interface EnvelopePayload {
  readonly envelope: SensitiveEnvelope;
}

interface OwnerOnboardingMaterial {
  readonly activationToken: string;
  readonly invitationToken: string;
}

let app: INestApplication;
let prisma: PrismaService;
let createSession: CreateSessionUseCase;
let adminSession: SessionFixture;
let deniedSession: SessionFixture;
let incorrectHostSession: SessionFixture;

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const originalValue = originalEnvironment[key];
  if (originalValue === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = originalValue;
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Readonly<Record<string, unknown>>;
}

function requireEnvelopePayload(value: unknown): EnvelopePayload {
  const payload = requireRecord(value);
  const envelope = requireRecord(payload.envelope);
  assert.deepEqual(Object.keys(envelope).sort(), ["ciphertext", "iv", "keyId", "tag", "version"]);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.keyId, ENVELOPE_KEY_ID);
  for (const field of ["iv", "ciphertext", "tag"] as const) {
    assert.equal(typeof envelope[field], "string");
    assert.notEqual(envelope[field], "");
  }
  assert.doesNotMatch(
    JSON.stringify(payload),
    /rawToken|secret|selector|serializedToken|tokenHash/iu,
  );
  return { envelope: envelope as unknown as SensitiveEnvelope };
}

function decryptOutboxToken(payload: unknown, associatedData: readonly string[]): string {
  const { envelope } = requireEnvelopePayload(payload);
  const plaintext = decryptSensitiveEnvelope({
    envelope,
    keyring: { [ENVELOPE_KEY_ID]: ENVELOPE_KEY },
    aad: new TextEncoder().encode(associatedData.join("\0")),
  });
  const decrypted = requireRecord(JSON.parse(new TextDecoder().decode(plaintext)));
  assert.equal(typeof decrypted.token, "string");
  assert.match(decrypted.token as string, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u);
  assert.equal(JSON.stringify(payload).includes(decrypted.token as string), false);
  return decrypted.token as string;
}

function decryptOwnerOnboardingMaterial(
  payload: unknown,
  associatedData: readonly string[],
): OwnerOnboardingMaterial {
  const { envelope } = requireEnvelopePayload(payload);
  const plaintext = decryptSensitiveEnvelope({
    envelope,
    keyring: { [ENVELOPE_KEY_ID]: ENVELOPE_KEY },
    aad: new TextEncoder().encode(associatedData.join("\0")),
  });
  const decrypted = requireRecord(JSON.parse(new TextDecoder().decode(plaintext)));
  assert.equal(typeof decrypted.activationToken, "string");
  assert.equal(typeof decrypted.invitationToken, "string");
  assert.match(decrypted.activationToken as string, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u);
  assert.match(decrypted.invitationToken as string, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u);
  assert.equal(JSON.stringify(payload).includes(decrypted.activationToken as string), false);
  assert.equal(JSON.stringify(payload).includes(decrypted.invitationToken as string), false);
  return {
    activationToken: decrypted.activationToken as string,
    invitationToken: decrypted.invitationToken as string,
  };
}

function key(suffix: string): string {
  return `${RUN_IDEMPOTENCY_KEY_PREFIX}-${suffix}`;
}

async function cleanupFixtures(): Promise<void> {
  if (!prisma) return;

  await prisma.tenantProvisioningRequest.deleteMany({
    where: { idempotencyKey: { startsWith: RUN_IDEMPOTENCY_KEY_PREFIX } },
  });

  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: RUN_SLUG_PREFIX } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  if (tenantIds.length > 0) {
    await prisma.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }

  const users = await prisma.user.findMany({
    where: { normalizedEmail: { startsWith: RUN_EMAIL_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  if (userIds.length === 0) return;

  await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.accountActivationToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: userIds } } });
  await prisma.securityAuditEvent.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { subjectUserId: { in: userIds } }],
    },
  });
  await prisma.roleAssignment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function ensureAuthorizationCatalog(): Promise<{ readonly platformAdminRoleId: string }> {
  const platformAdmin = await prisma.role.upsert({
    where: { key: "platform_admin" },
    update: { scopeLevel: "platform", isSystem: true },
    create: {
      id: randomUUID(),
      key: "platform_admin",
      scopeLevel: "platform",
      isSystem: true,
    },
  });
  await prisma.role.upsert({
    where: { key: "tenant_owner" },
    update: { scopeLevel: "tenant", isSystem: true },
    create: {
      id: randomUUID(),
      key: "tenant_owner",
      scopeLevel: "tenant",
      isSystem: true,
    },
  });
  const provisionPermission = await prisma.permission.upsert({
    where: { key: "platform.tenants.provision" },
    update: {
      scopeLevel: "platform",
      description: "Provision a tenant and its initial owner invitation.",
    },
    create: {
      id: randomUUID(),
      key: "platform.tenants.provision",
      scopeLevel: "platform",
      description: "Provision a tenant and its initial owner invitation.",
    },
  });
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: platformAdmin.id,
        permissionId: provisionPermission.id,
      },
    },
    update: {},
    create: {
      roleId: platformAdmin.id,
      permissionId: provisionPermission.id,
    },
  });
  return { platformAdminRoleId: platformAdmin.id };
}

async function seedUsersAndGrant(): Promise<void> {
  const { platformAdminRoleId } = await ensureAuthorizationCatalog();
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
        id: DENIED_USER_ID,
        normalizedEmail: DENIED_EMAIL,
        displayEmail: DENIED_EMAIL,
        status: "active",
        authorizationVersion: 1,
        activatedAt: now,
      },
      {
        id: EXISTING_OWNER_USER_ID,
        normalizedEmail: EXISTING_OWNER_EMAIL,
        displayEmail: EXISTING_OWNER_EMAIL,
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
}

async function createSessionFixture(
  userId: string,
  hostname: string,
  origin: string,
): Promise<SessionFixture> {
  const created = await createSession.execute({
    userId,
    scope: { type: "platform" },
    hostname,
    state: "active",
    authorizationVersion: 1,
    requestId: `fixture-session-${randomUUID()}`,
  });
  const cookie = `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(created.token)}`;
  const csrf = await request(app.getHttpServer())
    .get("/api/auth/session/csrf")
    .set("host", hostname)
    .set("cookie", cookie)
    .expect(200);
  assert.equal(typeof csrf.body.csrfToken, "string");
  return { cookie, csrfToken: csrf.body.csrfToken as string, hostname, origin };
}

function authenticatedPost(
  path: string,
  session: SessionFixture,
  body?: Readonly<Record<string, unknown>>,
) {
  const call = request(app.getHttpServer())
    .post(path)
    .set("host", session.hostname)
    .set("origin", session.origin)
    .set("cookie", session.cookie)
    .set("x-csrf-token", session.csrfToken);
  return body ? call.send(body) : call;
}

function requestHash(input: {
  readonly slug: string;
  readonly tenantName: string;
  readonly ownerEmail: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        actorUserId: ADMIN_USER_ID,
        slug: input.slug,
        tenantName: input.tenantName,
        ownerEmail: input.ownerEmail.trim().toLowerCase(),
        tenantHostname: `${input.slug}.example.test`,
      }),
    )
    .digest("hex");
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = PLATFORM_HOSTNAME;
  process.env.PORT = "3114";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_pr24_rls";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "platform-provisioning-e2e-secret-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = `${PLATFORM_ORIGIN},${INCORRECT_PLATFORM_ORIGIN}`;
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.IDENTITY_TOKEN_PEPPER = Buffer.alloc(32, 1).toString("base64");
  process.env.IDENTITY_ENVELOPE_KEYS = JSON.stringify({
    [ENVELOPE_KEY_ID]: ENVELOPE_KEY.toString("base64"),
  });
  process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID = ENVELOPE_KEY_ID;

  const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = testingModule.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();

  prisma = app.get(PrismaService);
  createSession = app.get(CreateSessionUseCase);
  await cleanupFixtures();
  await seedUsersAndGrant();
  adminSession = await createSessionFixture(ADMIN_USER_ID, PLATFORM_HOSTNAME, PLATFORM_ORIGIN);
  deniedSession = await createSessionFixture(DENIED_USER_ID, PLATFORM_HOSTNAME, PLATFORM_ORIGIN);
  incorrectHostSession = await createSessionFixture(
    ADMIN_USER_ID,
    INCORRECT_PLATFORM_HOSTNAME,
    INCORRECT_PLATFORM_ORIGIN,
  );
});

after(async () => {
  try {
    await cleanupFixtures();
  } finally {
    await app?.close();
    for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
      restoreEnvironmentValue(key);
    }
  }
});

test("platform provisioning enforces session, CSRF, database permission, and exact host", async () => {
  await request(app.getHttpServer())
    .post("/api/platform/tenants")
    .set("host", PLATFORM_HOSTNAME)
    .set("origin", PLATFORM_ORIGIN)
    .set("idempotency-key", key("missing-session"))
    .send(existingOwnerBody)
    .expect(401);

  const invalidToken = createSessionToken();
  await request(app.getHttpServer())
    .get(`/api/platform/tenants/${randomUUID()}`)
    .set("host", PLATFORM_HOSTNAME)
    .set("cookie", `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(invalidToken)}`)
    .expect(401);

  await request(app.getHttpServer())
    .post("/api/platform/tenants")
    .set("host", PLATFORM_HOSTNAME)
    .set("origin", PLATFORM_ORIGIN)
    .set("cookie", adminSession.cookie)
    .set("idempotency-key", key("missing-csrf"))
    .send(existingOwnerBody)
    .expect(403);

  await authenticatedPost("/api/platform/tenants", deniedSession, existingOwnerBody)
    .set("idempotency-key", key("permission-denied"))
    .set("x-actor-id", ADMIN_USER_ID)
    .set("x-auth-scope", "platform")
    .set("x-role", "platform_admin")
    .set("x-roles", "platform_admin")
    .set("x-permission", "platform.tenants.provision")
    .set("x-permissions", "platform.tenants.provision")
    .expect(403);

  await authenticatedPost("/api/platform/tenants", incorrectHostSession, existingOwnerBody)
    .set("idempotency-key", key("incorrect-host"))
    .expect(404);
});

test("POST provisions an existing owner and GET returns its database-backed state", async () => {
  const idempotencyKey = key("existing-owner");
  const response = await authenticatedPost("/api/platform/tenants", adminSession, existingOwnerBody)
    .set("idempotency-key", idempotencyKey)
    .expect(200);
  const result = response.body as ProvisioningResponse;

  assert.equal(result.slug, existingOwnerBody.slug);
  assert.equal(result.status, "provisioning");
  assert.equal(result.replayed, false);
  assert.match(result.tenantId, /^[0-9a-f-]{36}$/u);
  assert.match(result.ownerMembershipId, /^[0-9a-f-]{36}$/u);
  assert.match(result.ownerInvitationId, /^[0-9a-f-]{36}$/u);

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: result.tenantId },
    include: { domains: true },
  });
  assert.equal(tenant.slug, existingOwnerBody.slug);
  assert.equal(tenant.status, "provisioning");
  assert.deepEqual(
    tenant.domains.map(({ hostname, isPrimary }) => ({ hostname, isPrimary })),
    [{ hostname: `${existingOwnerBody.slug}.example.test`, isPrimary: true }],
  );

  const membership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { id: result.ownerMembershipId },
  });
  assert.equal(membership.tenantId, result.tenantId);
  assert.equal(membership.userId, EXISTING_OWNER_USER_ID);
  assert.equal(membership.status, "invited");

  const invitation = await prisma.membershipInvitation.findUniqueOrThrow({
    where: { id: result.ownerInvitationId },
  });
  assert.equal(invitation.invitedUserId, EXISTING_OWNER_USER_ID);
  assert.equal(invitation.intendedRoleKey, "tenant_owner");
  assert.equal(invitation.status, "pending");
  assert.equal(invitation.hostname, `${existingOwnerBody.slug}.example.test`);
  assert.match(invitation.tokenHash, /^[a-f0-9]{64}$/u);

  const events = await prisma.outboxEvent.findMany({
    where: { tenantId: result.tenantId },
  });
  assert.equal(events.length, 1);
  const invitationEvent = events[0];
  assert.ok(invitationEvent);
  assert.equal(invitationEvent.type, "membership.owner_invitation.requested.v1");
  assert.equal(invitationEvent.aggregateId, invitation.id);
  const decryptedInvitationToken = decryptOutboxToken(invitationEvent.payload, [
    "booking-os:membership-email:v1",
    "membership.owner_invitation.requested.v1",
    invitationEvent.id,
    result.tenantId,
    invitation.id,
    EXISTING_OWNER_USER_ID,
    invitation.hostname,
    EXISTING_OWNER_EMAIL,
    "tenant_owner",
  ]);
  assert.ok(decryptedInvitationToken.startsWith(`${invitation.selector}.`));
  assert.equal(
    await prisma.accountActivationToken.count({ where: { tenantId: result.tenantId } }),
    0,
  );

  const state = await request(app.getHttpServer())
    .get(`/api/platform/tenants/${result.tenantId}`)
    .set("host", PLATFORM_HOSTNAME)
    .set("cookie", adminSession.cookie)
    .expect(200);
  assert.deepEqual(state.body, {
    tenantId: result.tenantId,
    tenantName: existingOwnerBody.tenantName,
    slug: result.slug,
    status: "provisioning",
    ownerMembershipId: result.ownerMembershipId,
    ownerInvitationId: result.ownerInvitationId,
  });

  const replay = await authenticatedPost("/api/platform/tenants", adminSession, existingOwnerBody)
    .set("idempotency-key", idempotencyKey)
    .expect(200);
  assert.deepEqual(replay.body, { ...result, replayed: true });
  assert.equal(await prisma.tenant.count({ where: { slug: existingOwnerBody.slug } }), 1);

  await authenticatedPost("/api/platform/tenants", adminSession, {
    ...existingOwnerBody,
    tenantName: "A mismatched replay",
  })
    .set("idempotency-key", idempotencyKey)
    .expect(409);
});

test("POST provisions a pending owner with one onboarding event and resend rotates both artifacts", async () => {
  assert.equal(await prisma.user.count({ where: { normalizedEmail: PENDING_OWNER_EMAIL } }), 0);

  const response = await authenticatedPost("/api/platform/tenants", adminSession, pendingOwnerBody)
    .set("idempotency-key", key("pending-owner"))
    .expect(200);
  const result = response.body as ProvisioningResponse;
  const pendingOwner = await prisma.user.findUniqueOrThrow({
    where: { normalizedEmail: PENDING_OWNER_EMAIL },
  });
  assert.equal(pendingOwner.status, "pendingActivation");

  const originalInvitation = await prisma.membershipInvitation.findUniqueOrThrow({
    where: { id: result.ownerInvitationId },
  });
  const originalActivation = await prisma.accountActivationToken.findFirstOrThrow({
    where: {
      userId: pendingOwner.id,
      tenantId: result.tenantId,
      invitationId: originalInvitation.id,
      consumedAt: null,
      revokedAt: null,
    },
  });
  assert.equal(originalActivation.scopeType, "tenant");
  assert.equal(originalActivation.hostname, `${pendingOwnerBody.slug}.example.test`);
  assert.notEqual(originalActivation.selector, originalInvitation.selector);
  assert.notEqual(originalActivation.tokenHash, originalInvitation.tokenHash);

  const originalEvents = await prisma.outboxEvent.findMany({
    where: { tenantId: result.tenantId },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(
    originalEvents.map(({ type }) => type),
    ["membership.owner_onboarding.requested.v1"],
  );
  const originalOnboardingEvent = originalEvents[0];
  assert.ok(originalOnboardingEvent);
  assert.equal(originalOnboardingEvent.aggregateId, originalInvitation.id);
  const originalMaterial = decryptOwnerOnboardingMaterial(originalOnboardingEvent.payload, [
    "booking-os:owner-onboarding-email:v1",
    "membership.owner_onboarding.requested.v1",
    originalOnboardingEvent.id,
    result.tenantId,
    originalInvitation.id,
    pendingOwner.id,
    originalInvitation.hostname,
    PENDING_OWNER_EMAIL,
  ]);
  assert.ok(originalMaterial.invitationToken.startsWith(`${originalInvitation.selector}.`));
  assert.ok(originalMaterial.activationToken.startsWith(`${originalActivation.selector}.`));
  assert.notEqual(originalMaterial.invitationToken, originalMaterial.activationToken);

  const resend = await authenticatedPost(
    `/api/platform/tenants/${result.tenantId}/owner-invitation/resend`,
    adminSession,
  ).expect(202);
  assert.deepEqual(resend.body, { accepted: true });

  const invitations = await prisma.membershipInvitation.findMany({
    where: { tenantId: result.tenantId },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(invitations.length, 2);
  const revokedInvitation = invitations.find(({ id }) => id === originalInvitation.id);
  const replacementInvitation = invitations.find(({ id }) => id !== originalInvitation.id);
  assert.ok(revokedInvitation);
  assert.ok(replacementInvitation);
  assert.equal(revokedInvitation.status, "revoked");
  assert.ok(revokedInvitation.revokedAt);
  assert.equal(replacementInvitation.status, "pending");
  assert.equal(replacementInvitation.revokedAt, null);
  assert.notEqual(replacementInvitation.selector, originalInvitation.selector);
  assert.notEqual(replacementInvitation.tokenHash, originalInvitation.tokenHash);

  const activations = await prisma.accountActivationToken.findMany({
    where: { userId: pendingOwner.id, tenantId: result.tenantId },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(activations.length, 2);
  const revokedActivation = activations.find(({ id }) => id === originalActivation.id);
  const replacementActivation = activations.find(({ id }) => id !== originalActivation.id);
  assert.ok(revokedActivation?.revokedAt);
  assert.ok(replacementActivation);
  assert.equal(replacementActivation.revokedAt, null);
  assert.equal(replacementActivation.invitationId, replacementInvitation.id);
  assert.notEqual(replacementActivation.selector, originalActivation.selector);
  assert.notEqual(replacementActivation.tokenHash, originalActivation.tokenHash);

  const replacementEvents = await prisma.outboxEvent.findMany({
    where: { tenantId: result.tenantId },
  });
  assert.equal(replacementEvents.length, 2);
  assert.equal(
    replacementEvents.filter(({ type }) => type === "membership.owner_onboarding.requested.v1")
      .length,
    2,
  );
  assert.equal(
    replacementEvents.filter(
      ({ type }) =>
        type === "membership.owner_invitation.requested.v1" ||
        type === "identity.activation.requested.v1",
    ).length,
    0,
  );
  const replacementOnboardingEvent = replacementEvents.find(
    ({ aggregateId, type }) =>
      type === "membership.owner_onboarding.requested.v1" &&
      aggregateId === replacementInvitation.id,
  );
  assert.ok(replacementOnboardingEvent);
  const replacementMaterial = decryptOwnerOnboardingMaterial(replacementOnboardingEvent.payload, [
    "booking-os:owner-onboarding-email:v1",
    "membership.owner_onboarding.requested.v1",
    replacementOnboardingEvent.id,
    result.tenantId,
    replacementInvitation.id,
    pendingOwner.id,
    replacementInvitation.hostname,
    PENDING_OWNER_EMAIL,
  ]);
  assert.ok(replacementMaterial.invitationToken.startsWith(`${replacementInvitation.selector}.`));
  assert.ok(replacementMaterial.activationToken.startsWith(`${replacementActivation.selector}.`));
  assert.notEqual(replacementMaterial.invitationToken, originalMaterial.invitationToken);
  assert.notEqual(replacementMaterial.activationToken, originalMaterial.activationToken);
});

test("POST rejects a matching in-progress idempotency claim", async () => {
  const body = Object.freeze({
    slug: `${RUN_SLUG_PREFIX}-in-progress`,
    tenantName: "PR24 In Progress Tenant",
    ownerEmail: EXISTING_OWNER_EMAIL,
  });
  const idempotencyKey = key("in-progress");
  await prisma.tenantProvisioningRequest.create({
    data: {
      idempotencyKey,
      requestHash: requestHash(body),
      actorUserId: ADMIN_USER_ID,
      status: "inProgress",
    },
  });

  await authenticatedPost("/api/platform/tenants", adminSession, body)
    .set("idempotency-key", idempotencyKey)
    .expect(409);
});

test("POST maps both tenant slug and primary domain collisions to 409", async () => {
  const slugConflict = `${RUN_SLUG_PREFIX}-slug-conflict`;
  await prisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: slugConflict,
      name: "Existing Slug Holder",
      status: "provisioning",
      domains: {
        create: {
          hostname: `${slugConflict}-holder.example.test`,
          isPrimary: true,
        },
      },
    },
  });
  await authenticatedPost("/api/platform/tenants", adminSession, {
    slug: slugConflict,
    tenantName: "Conflicting Slug Tenant",
    ownerEmail: EXISTING_OWNER_EMAIL,
  })
    .set("idempotency-key", key("slug-conflict"))
    .expect(409);

  const requestedDomainSlug = `${RUN_SLUG_PREFIX}-domain-conflict`;
  await prisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `${RUN_SLUG_PREFIX}-domain-holder`,
      name: "Existing Domain Holder",
      status: "provisioning",
      domains: {
        create: {
          hostname: `${requestedDomainSlug}.example.test`,
          isPrimary: true,
        },
      },
    },
  });
  await authenticatedPost("/api/platform/tenants", adminSession, {
    slug: requestedDomainSlug,
    tenantName: "Conflicting Domain Tenant",
    ownerEmail: EXISTING_OWNER_EMAIL,
  })
    .set("idempotency-key", key("domain-conflict"))
    .expect(409);
});
