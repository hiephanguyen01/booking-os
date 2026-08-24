import assert from "node:assert/strict";
import test from "node:test";

import type { TenantExecutionContext } from "@booking-os/contracts";

import type { OneTimeTokenPort } from "../../../identity/application/ports/one-time-token.port.js";
import type { PartnerDataSession } from "../ports/partner-data-session.js";
import type { PartnerTransactionPort } from "../ports/partner-transaction.port.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "30000000-0000-4000-8000-000000000002";
const TENANT_MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000003";
const CHALLENGE_ID = "30000000-0000-4000-8000-000000000004";
const PARTNER_ID = "30000000-0000-4000-8000-000000000005";
const PARTNER_MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000006";
const NOW = new Date("2026-08-23T00:00:00.000Z");
const CONTEXT: TenantExecutionContext = {
  tenantId: TENANT_ID,
  requestId: "req-partner-registration-complete",
  traceId: "trace-partner-registration-complete",
  source: "storefront",
};

interface ChallengeOverrides {
  readonly hostname?: string;
  readonly expiresAt?: Date;
  readonly revokedAt?: Date | null;
  readonly consumedAt?: Date | null;
  readonly completedPartnerId?: string | null;
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
  const modulePath = "./complete-partner-registration.js";
  const loaded = (await import(modulePath)) as Record<string, unknown>;
  return loaded.CompletePartnerRegistrationUseCase as never;
}

function createHarness(
  challengeOverrides: ChallengeOverrides = {},
  options: { readonly tokenValid?: boolean } = {},
) {
  const events: string[] = [];
  const auditInputs: unknown[] = [];
  const challenge = {
    id: CHALLENGE_ID,
    tenantId: TENANT_ID,
    normalizedEmail: "partner@example.test",
    displayEmail: "Partner@example.test",
    partnerType: "company" as const,
    hostname: challengeOverrides.hostname ?? "studiohub.example.test",
    selector: "challenge-selector",
    tokenHash: "a".repeat(64),
    expiresAt: challengeOverrides.expiresAt ?? new Date(NOW.getTime() + 60 * 60 * 1000),
    consumedAt: challengeOverrides.consumedAt ?? null,
    revokedAt: challengeOverrides.revokedAt ?? null,
    completedPartnerId: challengeOverrides.completedPartnerId ?? null,
    createdAt: new Date(NOW.getTime() - 60_000),
  };

  const session = {
    partnerRegistrationChallenges: {
      async lockBySelector(selector: string) {
        events.push("challenge.lock");
        assert.equal(selector, "challenge-selector");
        return challenge;
      },
      async markCompleted(input: {
        readonly challengeId: string;
        readonly partnerId: string;
        readonly consumedAt: Date;
      }) {
        events.push("challenge.complete");
        assert.deepEqual(input, {
          challengeId: CHALLENGE_ID,
          partnerId: PARTNER_ID,
          consumedAt: NOW,
        });
      },
    },
    partnerRegistrationIdentity: {
      async resolveOrCreateVerifiedIdentity(input: {
        readonly normalizedEmail: string;
        readonly displayEmail: string;
        readonly password?: string;
      }) {
        events.push("identity.resolve");
        assert.deepEqual(input, {
          normalizedEmail: "partner@example.test",
          displayEmail: "Partner@example.test",
          password: "Valid-Password-123!",
        });
        return {
          userId: USER_ID,
          userAuthorizationVersion: 1,
          wasUserCreatedOrActivated: true,
        };
      },
      async ensureActiveTenantMembership(input: {
        readonly tenantId: string;
        readonly userId: string;
      }) {
        events.push("tenant-membership.ensure");
        assert.deepEqual(input, { tenantId: TENANT_ID, userId: USER_ID });
        return {
          tenantMembershipId: TENANT_MEMBERSHIP_ID,
          tenantMembershipAuthorizationVersion: 1,
          wasCreated: true,
        };
      },
    },
    partnerRegistrationEstablishment: {
      async createPartner(input: Record<string, unknown>) {
        events.push("partner.create");
        assert.deepEqual(input, {
          challengeId: CHALLENGE_ID,
          partnerType: "company",
          now: NOW,
        });
        return { partnerId: PARTNER_ID };
      },
      async createPartnerMembership(input: Record<string, unknown>) {
        events.push("partner-membership.create");
        assert.deepEqual(input, {
          partnerId: PARTNER_ID,
          tenantMembershipId: TENANT_MEMBERSHIP_ID,
          now: NOW,
        });
        return { partnerMembershipId: PARTNER_MEMBERSHIP_ID };
      },
      async assignPartnerOwner(input: Record<string, unknown>) {
        events.push("partner-owner.assign");
        assert.deepEqual(input, {
          partnerId: PARTNER_ID,
          partnerMembershipId: PARTNER_MEMBERSHIP_ID,
          now: NOW,
        });
      },
      async appendRegistrationHistory(input: Record<string, unknown>) {
        events.push("history.append");
        assert.deepEqual(input, {
          partnerId: PARTNER_ID,
          applicationStatus: "draft",
          operationalStatus: "inactive",
          occurredAt: NOW,
        });
      },
      async appendRegistrationOutbox(input: Record<string, unknown>) {
        events.push("outbox.append");
        assert.deepEqual(input, {
          partnerId: PARTNER_ID,
          occurredAt: NOW,
        });
      },
    },
    partnerSecurityAudit: {
      async append(input: unknown) {
        events.push("audit.append");
        auditInputs.push(input);
      },
    },
  } as unknown as PartnerDataSession;

  const transactions: PartnerTransactionPort = {
    async run<T>(
      context: TenantExecutionContext,
      work: (session: PartnerDataSession) => Promise<T>,
    ) {
      assert.deepEqual(context, CONTEXT);
      return work(session);
    },
  };

  const oneTimeTokens: OneTimeTokenPort = {
    issue() {
      throw new Error("not used");
    },
    derive(serialized, purpose) {
      events.push("token.derive");
      assert.equal(serialized, "partner-registration.serialized");
      assert.equal(purpose, "partner_registration");
      return { selector: "challenge-selector", tokenHash: "unused-derived-hash" };
    },
    verify(serialized, purpose, expectedTokenHash) {
      events.push("token.verify");
      assert.equal(serialized, "partner-registration.serialized");
      assert.equal(purpose, "partner_registration");
      assert.equal(expectedTokenHash, "a".repeat(64));
      return options.tokenValid === false ? null : { selector: "challenge-selector" };
    },
  };

  return { auditInputs, events, oneTimeTokens, transactions };
}

test("verified completion establishes Partner authority in the mandated transaction order", async () => {
  const harness = createHarness();
  const UseCase = await loadUseCase();
  const useCase = new UseCase(harness.transactions, harness.oneTimeTokens);

  const result = await useCase.execute({
    context: CONTEXT,
    hostname: "studiohub.example.test",
    serializedToken: "partner-registration.serialized",
    password: "Valid-Password-123!",
    now: NOW,
  });

  assert.deepEqual(result, { partnerId: PARTNER_ID });
  assert.deepEqual(harness.events, [
    "token.derive",
    "challenge.lock",
    "token.verify",
    "identity.resolve",
    "tenant-membership.ensure",
    "partner.create",
    "partner-membership.create",
    "partner-owner.assign",
    "challenge.complete",
    "history.append",
    "audit.append",
    "outbox.append",
  ]);
  assert.equal(harness.auditInputs.length, 1);
  assert.deepEqual(harness.auditInputs[0], {
    eventType: "partner.registration.completed",
    actorUserId: USER_ID,
    subjectUserId: USER_ID,
    requestId: CONTEXT.requestId,
    metadata: { result: "completed", reason: "verified" },
    occurredAt: NOW,
  });
});

test("repeated verified completion returns the canonical Partner without duplicate side effects", async () => {
  const harness = createHarness({
    consumedAt: new Date(NOW.getTime() - 1_000),
    completedPartnerId: PARTNER_ID,
  });
  const UseCase = await loadUseCase();
  const useCase = new UseCase(harness.transactions, harness.oneTimeTokens);

  assert.deepEqual(
    await useCase.execute({
      context: CONTEXT,
      hostname: "studiohub.example.test",
      serializedToken: "partner-registration.serialized",
      now: NOW,
    }),
    { partnerId: PARTNER_ID },
  );
  assert.deepEqual(harness.events, ["token.derive", "challenge.lock", "token.verify"]);
});

test("invalid, expired, revoked, or wrong-host completion never establishes or consumes", async () => {
  const cases = [
    { name: "invalid-token", overrides: {}, options: { tokenValid: false } },
    {
      name: "expired",
      overrides: { expiresAt: new Date(NOW.getTime() - 1) },
      options: {},
    },
    { name: "revoked", overrides: { revokedAt: NOW }, options: {} },
    {
      name: "wrong-host",
      overrides: { hostname: "other.example.test" },
      options: {},
    },
  ] as const;

  for (const entry of cases) {
    const harness = createHarness(entry.overrides, entry.options);
    const UseCase = await loadUseCase();
    const useCase = new UseCase(harness.transactions, harness.oneTimeTokens);

    await assert.rejects(
      () =>
        useCase.execute({
          context: CONTEXT,
          hostname: "studiohub.example.test",
          serializedToken: "partner-registration.serialized",
          password: "Valid-Password-123!",
          now: NOW,
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "PARTNER_REGISTRATION_CHALLENGE_INVALID",
      entry.name,
    );

    assert.equal(harness.events.includes("identity.resolve"), false, entry.name);
    assert.equal(harness.events.includes("partner.create"), false, entry.name);
    assert.equal(harness.events.includes("challenge.complete"), false, entry.name);
  }
});
