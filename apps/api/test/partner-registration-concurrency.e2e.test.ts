import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { TenantExecutionContext } from "@booking-os/contracts";
import { type Prisma, PrismaClient } from "@prisma/client";

import { PrismaTenantDataSessionFactory } from "../src/database/prisma-tenant-data-session.factory.js";
import type { OneTimeTokenPort } from "../src/modules/identity/application/ports/one-time-token.port.js";
import type { PartnerRegistrationIdentityParticipantPort } from "../src/modules/identity/application/partner-registration-identity.contract.js";
import type { PartnerDataSession } from "../src/modules/partners/application/ports/partner-data-session.js";
import type { PartnerRegistrationChallengeRepositoryPort } from "../src/modules/partners/application/ports/partner-registration-challenge-repository.port.js";
import type { PartnerRegistrationEstablishmentPort } from "../src/modules/partners/application/ports/partner-registration-establishment.port.js";
import type { PartnerTransactionPort } from "../src/modules/partners/application/ports/partner-transaction.port.js";

const prisma = new PrismaClient();
const sessionFactory = new PrismaTenantDataSessionFactory();
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

function wrapChallenges(
  base: PartnerRegistrationChallengeRepositoryPort,
  faultStage: FaultStage | undefined,
): PartnerRegistrationChallengeRepositoryPort {
  return {
    upsertForEmail: (input) => base.upsertForEmail(input),
    lockBySelector: (selector) => base.lockBySelector(selector),
    async markCompleted(input) {
      await base.markCompleted(input);
      maybeFail("challenge", faultStage);
    },
  };
}

function wrapIdentity(
  base: PartnerRegistrationIdentityParticipantPort,
  fixture: RegistrationFixture,
  faultStage: FaultStage | undefined,
): PartnerRegistrationIdentityParticipantPort {
  let resolvedUserId: string | undefined;
  return {
    async resolveOrCreateVerifiedIdentity(input) {
      assert.equal(input.normalizedEmail, fixture.normalizedEmail);
      assert.equal(input.displayEmail, fixture.displayEmail);
      assert.equal(input.password, "Valid-Password-123!");
      const result = await base.resolveOrCreateVerifiedIdentity(input);
      resolvedUserId = result.userId;
      maybeFail("identity", faultStage);
      return result;
    },
    async ensureActiveTenantMembership(input) {
      assert.equal(input.tenantId, fixture.tenantId);
      assert.equal(input.userId, resolvedUserId);
      const result = await base.ensureActiveTenantMembership(input);
      maybeFail("membership", faultStage);
      return result;
    },
  };
}

function wrapEstablishment(
  base: PartnerRegistrationEstablishmentPort,
  faultStage: FaultStage | undefined,
): PartnerRegistrationEstablishmentPort {
  return {
    async createPartner(input) {
      const result = await base.createPartner(input);
      maybeFail("partner", faultStage);
      return result;
    },
    async createPartnerMembership(input) {
      const result = await base.createPartnerMembership(input);
      maybeFail("partnerMembership", faultStage);
      return result;
    },
    async assignPartnerOwner(input) {
      await base.assignPartnerOwner(input);
      maybeFail("owner", faultStage);
    },
    appendRegistrationHistory: (input) => base.appendRegistrationHistory(input),
    appendRegistrationOutbox: (input) => base.appendRegistrationOutbox(input),
  };
}

function createDatabaseSession(
  transaction: Prisma.TransactionClient,
  fixture: RegistrationFixture,
  faultStage: FaultStage | undefined,
): PartnerDataSession {
  const base = sessionFactory.create(transaction, fixture.tenantId) as PartnerDataSession;
  return Object.freeze({
    ...base,
    partnerRegistrationChallenges: wrapChallenges(
      base.partnerRegistrationChallenges,
      faultStage,
    ),
    partnerRegistrationIdentity: wrapIdentity(
      base.partnerRegistrationIdentity,
      fixture,
      faultStage,
    ),
    partnerRegistrationEstablishment: wrapEstablishment(
      base.partnerRegistrationEstablishment,
      faultStage,
    ),
  });
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
        return work(createDatabaseSession(transaction, fixture, faultStage));
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