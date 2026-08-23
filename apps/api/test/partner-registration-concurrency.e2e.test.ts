import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { TenantExecutionContext } from "@booking-os/contracts";
import { type Prisma, PrismaClient } from "@prisma/client";

import type { OneTimeTokenPort } from "../src/modules/identity/application/ports/one-time-token.port.js";
import type { PartnerDataSession } from "../src/modules/partners/application/ports/partner-data-session.js";
import type { PartnerTransactionPort } from "../src/modules/partners/application/ports/partner-transaction.port.js";

const prisma = new PrismaClient();
const HOSTNAME = "studiohub.example.test";
const NOW = new Date("2026-08-23T00:00:00.000Z");
const TOKEN_HASH = "a".repeat(64);
const SERIALIZED_TOKEN = "partner-registration.serialized";
const PARTNER_REGISTRATION_PURPOSE = "partner_registration";

type FaultStage =
  | "identity"
  | "membership"
  | "partner"
  | "partnerMembership"
  | "owner"
  | "challenge";

interface RegistrationFixture {
  readonly tenantId: string;
  readonly challengeId: string;
  readonly selector: string;
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly context: TenantExecutionContext;
}

interface ChallengeRow {
  readonly id: string;
  readonly tenantId: string;
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly partnerType: "individual" | "company";
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly completedPartnerId: string | null;
  readonly createdAt: Date;
}

interface IdRow {
  readonly id: string;
}

interface UserRow extends IdRow {
  readonly authorizationVersion: number;
}

interface MembershipRow extends IdRow {
  readonly authorizationVersion: number;
}

async function loadUseCase(): Promise<
  new (
    transactions: PartnerTransactionPort,
    oneTimeTokens: OneTimeTokenPort,
  ) => {
    execute(input: {
      context: TenantExecutionContext;
      hostname: string;
      serializedToken: string;
      password?: string;
      now: Date;
    }): Promise<{ readonly partnerId: string }>;
  }
> {
  const modulePath =
    "../src/modules/partners/application/use-cases/complete-partner-registration.js";
  const loaded = (await import(modulePath)) as Record<string, unknown>;
  return loaded.CompletePartnerRegistrationUseCase as never;
}

async function createFixture(): Promise<RegistrationFixture> {
  const tenantId = randomUUID();
  const challengeId = randomUUID();
  const selector = randomUUID();
  const suffix = randomUUID();
  const normalizedEmail = `partner-${suffix}@example.test`;
  const displayEmail = `Partner-${suffix}@example.test`;

  await prisma.tenant.create({
    data: {
      id: tenantId,
      slug: `partner-${suffix}`,
      name: "Partner registration atomicity test",
      status: "provisioning",
    },
  });
  await prisma.partnerRegistrationChallenge.create({
    data: {
      id: challengeId,
      tenantId,
      normalizedEmail,
      displayEmail,
      partnerType: "company",
      hostname: HOSTNAME,
      selector,
      tokenHash: TOKEN_HASH,
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      createdAt: NOW,
    },
  });

  return {
    tenantId,
    challengeId,
    selector,
    normalizedEmail,
    displayEmail,
    context: {
      tenantId,
      requestId: `req-${suffix}`,
      traceId: `trace-${suffix}`,
      source: "storefront",
    },
  };
}

async function cleanupFixture(fixture: RegistrationFixture): Promise<void> {
  await prisma.tenant.deleteMany({ where: { id: fixture.tenantId } });
  await prisma.user.deleteMany({ where: { normalizedEmail: fixture.normalizedEmail } });
}

function createTokenPort(fixture: RegistrationFixture): OneTimeTokenPort {
  return {
    issue() {
      throw new Error("issue is not used during registration completion");
    },
    derive(serialized, purpose) {
      assert.equal(serialized, SERIALIZED_TOKEN);
      assert.equal(purpose, PARTNER_REGISTRATION_PURPOSE);
      return { selector: fixture.selector, tokenHash: "derived-but-not-authoritative" };
    },
    verify(serialized, purpose, expectedTokenHash) {
      assert.equal(serialized, SERIALIZED_TOKEN);
      assert.equal(purpose, PARTNER_REGISTRATION_PURPOSE);
      assert.equal(expectedTokenHash, TOKEN_HASH);
      return { selector: fixture.selector };
    },
  };
}

function maybeFail(stage: FaultStage, faultStage: FaultStage | undefined): void {
  if (stage === faultStage) throw new Error(`forced-partner-registration-failure:${stage}`);
}

function createDatabaseSession(
  transaction: Prisma.TransactionClient,
  fixture: RegistrationFixture,
  faultStage: FaultStage | undefined,
): PartnerDataSession {
  let userId: string | undefined;

  const session = {
    partnerRegistrationChallenges: {
      async lockBySelector(selector: string) {
        const rows = await transaction.$queryRawUnsafe<readonly ChallengeRow[]>(
          `SELECT
             "id",
             "tenant_id" AS "tenantId",
             "normalized_email" AS "normalizedEmail",
             "display_email" AS "displayEmail",
             "partner_type"::text AS "partnerType",
             "hostname",
             "selector",
             "token_hash" AS "tokenHash",
             "expires_at" AS "expiresAt",
             "consumed_at" AS "consumedAt",
             "revoked_at" AS "revokedAt",
             "completed_partner_id" AS "completedPartnerId",
             "created_at" AS "createdAt"
           FROM "partner_registration_challenges"
           WHERE "tenant_id" = $1::uuid
             AND "selector" = $2
           FOR UPDATE`,
          fixture.tenantId,
          selector,
        );
        return rows[0] ?? null;
      },
      async markCompleted(input: {
        readonly challengeId: string;
        readonly partnerId: string;
        readonly consumedAt: Date;
      }) {
        await transaction.$executeRawUnsafe(
          `UPDATE "partner_registration_challenges"
           SET "completed_partner_id" = $3::uuid,
               "consumed_at" = $4
           WHERE "tenant_id" = $1::uuid
             AND "id" = $2::uuid
             AND "completed_partner_id" IS NULL`,
          fixture.tenantId,
          input.challengeId,
          input.partnerId,
          input.consumedAt,
        );
        maybeFail("challenge", faultStage);
      },
    },
    partnerRegistrationIdentity: {
      async resolveOrCreateVerifiedIdentity(input: {
        readonly normalizedEmail: string;
        readonly displayEmail: string;
        readonly password?: string;
      }) {
        assert.equal(input.normalizedEmail, fixture.normalizedEmail);
        assert.equal(input.displayEmail, fixture.displayEmail);
        assert.equal(input.password, "Valid-Password-123!");
        const users = await transaction.$queryRawUnsafe<readonly UserRow[]>(
          `INSERT INTO "users" (
             "normalized_email", "display_email", "status", "authorization_version"
           )
           VALUES ($1, $2, 'active'::user_status, 1)
           RETURNING "id", "authorization_version" AS "authorizationVersion"`,
          input.normalizedEmail,
          input.displayEmail,
        );
        const user = users[0];
        if (!user) throw new Error("test identity creation failed");
        userId = user.id;
        await transaction.$executeRawUnsafe(
          `INSERT INTO "password_credentials" (
             "user_id", "password_hash", "algorithm", "parameters", "password_changed_at"
           )
           VALUES ($1::uuid, $2, 'argon2id', '{}'::jsonb, $3)`,
          user.id,
          "test-only-password-hash",
          NOW,
        );
        maybeFail("identity", faultStage);
        return {
          userId: user.id,
          userAuthorizationVersion: user.authorizationVersion,
          wasUserCreatedOrActivated: true,
        };
      },
      async ensureActiveTenantMembership(input: {
        readonly tenantId: string;
        readonly userId: string;
      }) {
        assert.equal(input.tenantId, fixture.tenantId);
        assert.equal(input.userId, userId);
        const rows = await transaction.$queryRawUnsafe<readonly MembershipRow[]>(
          `INSERT INTO "tenant_memberships" (
             "tenant_id", "user_id", "status", "authorization_version"
           )
           VALUES ($1::uuid, $2::uuid, 'active'::tenant_membership_status, 1)
           RETURNING "id", "authorization_version" AS "authorizationVersion"`,
          input.tenantId,
          input.userId,
        );
        const membership = rows[0];
        if (!membership) throw new Error("test membership creation failed");
        maybeFail("membership", faultStage);
        return {
          tenantMembershipId: membership.id,
          tenantMembershipAuthorizationVersion: membership.authorizationVersion,
          wasCreated: true,
        };
      },
    },
    partnerRegistrationEstablishment: {
      async createPartner(input: {
        readonly challengeId: string;
        readonly partnerType: "individual" | "company";
        readonly now: Date;
      }) {
        const rows = await transaction.$queryRawUnsafe<readonly IdRow[]>(
          `INSERT INTO "partners" (
             "tenant_id", "registration_challenge_id", "type",
             "application_status", "operational_status", "authorization_version", "version",
             "created_at", "updated_at"
           )
           VALUES (
             $1::uuid, $2::uuid, $3::partner_type,
             'draft'::partner_application_status, 'inactive'::partner_operational_status, 1, 1,
             $4, $4
           )
           RETURNING "id"`,
          fixture.tenantId,
          input.challengeId,
          input.partnerType,
          input.now,
        );
        const partner = rows[0];
        if (!partner) throw new Error("test Partner creation failed");
        maybeFail("partner", faultStage);
        return { partnerId: partner.id };
      },
      async createPartnerMembership(input: {
        readonly partnerId: string;
        readonly tenantMembershipId: string;
        readonly now: Date;
      }) {
        const rows = await transaction.$queryRawUnsafe<readonly IdRow[]>(
          `INSERT INTO "partner_memberships" (
             "tenant_id", "partner_id", "tenant_membership_id", "status",
             "authorization_version", "created_at", "updated_at"
           )
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'active'::partner_membership_status, 1, $4, $4)
           RETURNING "id"`,
          fixture.tenantId,
          input.partnerId,
          input.tenantMembershipId,
          input.now,
        );
        const membership = rows[0];
        if (!membership) throw new Error("test Partner membership creation failed");
        maybeFail("partnerMembership", faultStage);
        return { partnerMembershipId: membership.id };
      },
      async assignPartnerOwner(input: {
        readonly partnerId: string;
        readonly partnerMembershipId: string;
        readonly now: Date;
      }) {
        await transaction.$executeRawUnsafe(
          `INSERT INTO "partner_system_role_assignments" (
             "tenant_id", "partner_id", "partner_membership_id", "role_id", "created_at"
           )
           SELECT $1::uuid, $2::uuid, $3::uuid, "id", $4
           FROM "roles"
           WHERE "key" = 'partner_owner'`,
          fixture.tenantId,
          input.partnerId,
          input.partnerMembershipId,
          input.now,
        );
        maybeFail("owner", faultStage);
      },
      async appendRegistrationHistory(input: {
        readonly partnerId: string;
        readonly applicationStatus: string;
        readonly operationalStatus: string;
        readonly occurredAt: Date;
      }) {
        await transaction.$executeRawUnsafe(
          `INSERT INTO "partner_status_history" (
             "tenant_id", "partner_id", "application_status", "operational_status", "occurred_at"
           )
           VALUES ($1::uuid, $2::uuid, $3::partner_application_status,
             $4::partner_operational_status, $5)`,
          fixture.tenantId,
          input.partnerId,
          input.applicationStatus,
          input.operationalStatus,
          input.occurredAt,
        );
      },
      async appendRegistrationOutbox(input: {
        readonly partnerId: string;
        readonly occurredAt: Date;
      }) {
        await transaction.$executeRawUnsafe(
          `INSERT INTO "outbox_events" (
             "id", "tenant_id", "type", "aggregate_type", "aggregate_id", "payload", "occurred_at"
           )
           VALUES (
             gen_random_uuid(), $1::uuid, 'partner.registration.completed', 'partner', $2::uuid,
             jsonb_build_object('partnerId', $2::text), $3
           )`,
          fixture.tenantId,
          input.partnerId,
          input.occurredAt,
        );
      },
    },
    partnerSecurityAudit: {
      async append(input: {
        readonly eventType: string;
        readonly actorUserId: string | null;
        readonly subjectUserId: string | null;
        readonly requestId: string | null;
        readonly metadata: Readonly<Record<string, string>>;
        readonly occurredAt: Date;
      }) {
        await transaction.$executeRawUnsafe(
          `INSERT INTO "tenant_security_audit_events" (
             "tenant_id", "event_type", "actor_user_id", "subject_user_id",
             "request_id", "metadata", "occurred_at"
           )
           VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6::jsonb, $7)`,
          fixture.tenantId,
          input.eventType,
          input.actorUserId,
          input.subjectUserId,
          input.requestId,
          JSON.stringify(input.metadata),
          input.occurredAt,
        );
      },
    },
  };

  return session as unknown as PartnerDataSession;
}

function createTransactionPort(
  fixture: RegistrationFixture,
  faultStage: FaultStage | undefined,
  timeline: string[],
): PartnerTransactionPort {
  return {
    async run<T>(
      context: TenantExecutionContext,
      work: (session: PartnerDataSession) => Promise<T>,
    ): Promise<T> {
      assert.equal(context.tenantId, fixture.tenantId);
      timeline.push("transaction.begin");
      const result = await prisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
        await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${fixture.tenantId}, true)`;
        const session = createDatabaseSession(transaction, fixture, faultStage);
        return work(session);
      });
      timeline.push("transaction.commit");
      return result;
    },
  };
}

async function assertFullyRolledBack(fixture: RegistrationFixture): Promise<void> {
  const challenge = await prisma.partnerRegistrationChallenge.findUniqueOrThrow({
    where: { id: fixture.challengeId },
  });
  assert.equal(challenge.consumedAt, null);
  assert.equal(challenge.completedPartnerId, null);
  assert.equal(await prisma.user.count({ where: { normalizedEmail: fixture.normalizedEmail } }), 0);
  assert.equal(await prisma.tenantMembership.count({ where: { tenantId: fixture.tenantId } }), 0);
  assert.equal(await prisma.partner.count({ where: { tenantId: fixture.tenantId } }), 0);
  assert.equal(await prisma.partnerMembership.count({ where: { tenantId: fixture.tenantId } }), 0);
  assert.equal(
    await prisma.partnerSystemRoleAssignment.count({ where: { tenantId: fixture.tenantId } }),
    0,
  );
  assert.equal(
    await prisma.tenantSecurityAuditEvent.count({ where: { tenantId: fixture.tenantId } }),
    0,
  );
  assert.equal(await prisma.outboxEvent.count({ where: { tenantId: fixture.tenantId } }), 0);
}

async function complete(
  fixture: RegistrationFixture,
  faultStage: FaultStage | undefined,
  timeline: string[],
): Promise<{ readonly partnerId: string }> {
  const UseCase = await loadUseCase();
  const useCase = new UseCase(
    createTransactionPort(fixture, faultStage, timeline),
    createTokenPort(fixture),
  );
  return useCase.execute({
    context: fixture.context,
    hostname: HOSTNAME,
    serializedToken: SERIALIZED_TOKEN,
    password: "Valid-Password-123!",
    now: NOW,
  });
}

test("Partner registration rolls every earlier establishment stage back on a later failure", async () => {
  const faultStages: readonly FaultStage[] = [
    "identity",
    "membership",
    "partner",
    "partnerMembership",
    "owner",
    "challenge",
  ];

  for (const faultStage of faultStages) {
    const fixture = await createFixture();
    try {
      await assert.rejects(
        () => complete(fixture, faultStage, []),
        new RegExp(`forced-partner-registration-failure:${faultStage}`),
      );
      await assertFullyRolledBack(fixture);
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("successful establishment commits all rows before post-commit Partner session issuance", async () => {
  const fixture = await createFixture();
  const timeline: string[] = [];
  try {
    const result = await complete(fixture, undefined, timeline);

    const challenge = await prisma.partnerRegistrationChallenge.findUniqueOrThrow({
      where: { id: fixture.challengeId },
    });
    assert.equal(challenge.completedPartnerId, result.partnerId);
    assert.equal(challenge.consumedAt?.getTime(), NOW.getTime());
    assert.equal(
      await prisma.user.count({ where: { normalizedEmail: fixture.normalizedEmail } }),
      1,
    );
    assert.equal(await prisma.tenantMembership.count({ where: { tenantId: fixture.tenantId } }), 1);
    assert.equal(await prisma.partner.count({ where: { tenantId: fixture.tenantId } }), 1);
    assert.equal(
      await prisma.partnerMembership.count({ where: { tenantId: fixture.tenantId } }),
      1,
    );
    assert.equal(
      await prisma.partnerSystemRoleAssignment.count({ where: { tenantId: fixture.tenantId } }),
      1,
    );
    assert.equal(
      await prisma.tenantSecurityAuditEvent.count({ where: { tenantId: fixture.tenantId } }),
      1,
    );
    assert.equal(await prisma.outboxEvent.count({ where: { tenantId: fixture.tenantId } }), 1);

    assert.deepEqual(timeline, ["transaction.begin", "transaction.commit"]);
    timeline.push("partner-session.issue");
    assert.deepEqual(timeline, [
      "transaction.begin",
      "transaction.commit",
      "partner-session.issue",
    ]);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("concurrent verified completions converge to one Partner and one active owner assignment", async () => {
  const fixture = await createFixture();
  try {
    const [first, second] = await Promise.allSettled([
      complete(fixture, undefined, []),
      complete(fixture, undefined, []),
    ]);
    assert.equal(first.status, "fulfilled");
    assert.equal(second.status, "fulfilled");
    if (first.status !== "fulfilled" || second.status !== "fulfilled") return;
    assert.equal(first.value.partnerId, second.value.partnerId);
    assert.equal(await prisma.partner.count({ where: { tenantId: fixture.tenantId } }), 1);
    assert.equal(
      await prisma.partnerMembership.count({ where: { tenantId: fixture.tenantId } }),
      1,
    );
    assert.equal(
      await prisma.partnerSystemRoleAssignment.count({
        where: { tenantId: fixture.tenantId, revokedAt: null },
      }),
      1,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});
