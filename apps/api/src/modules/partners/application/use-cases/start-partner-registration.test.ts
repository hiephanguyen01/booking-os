import assert from "node:assert/strict";
import test from "node:test";

import type { TenantExecutionContext } from "@booking-os/contracts";

import type { OneTimeTokenPort } from "../../../identity/application/ports/one-time-token.port.js";
import type { PartnerDataSession } from "../ports/partner-data-session.js";
import type { PartnerTransactionPort } from "../ports/partner-transaction.port.js";
import { StartPartnerRegistrationUseCase } from "./start-partner-registration.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const TENANT_MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000201";
const NOW = new Date("2026-08-23T00:00:00.000Z");
const CONTEXT: TenantExecutionContext = {
  tenantId: TENANT_ID,
  requestId: "req-partner-registration-start",
  traceId: "trace-partner-registration-start",
  source: "storefront",
};

type RegistrationStartEligibility =
  | {
      readonly eligible: true;
      readonly tenantMembershipId: string | null;
    }
  | {
      readonly eligible: false;
      readonly reason: "identity_unavailable" | "tenant_membership_unavailable";
    };

interface HarnessOptions {
  readonly eligibility?: RegistrationStartEligibility;
  readonly existingPartner?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const events: string[] = [];
  let auditInput: Record<string, unknown> | undefined;
  let challengeInput: Record<string, unknown> | undefined;
  let notificationInput: Record<string, unknown> | undefined;

  const eligibility = options.eligibility ?? {
    eligible: true as const,
    tenantMembershipId: null,
  };

  const session = {
    partnerRegistrationStartEligibility: {
      async classifyStart(input: { readonly normalizedEmail: string }) {
        events.push("eligibility");
        assert.equal(input.normalizedEmail.includes("@"), true);
        return eligibility;
      },
    },
    partners: {
      async hasMembershipForTenantMembership(tenantMembershipId: string) {
        events.push("partner-membership-probe");
        assert.equal(tenantMembershipId, TENANT_MEMBERSHIP_ID);
        return options.existingPartner ?? false;
      },
    },
    partnerRegistrationChallenges: {
      async upsertForEmail(input: Record<string, unknown>) {
        challengeInput = input;
        events.push("challenge");
        return {
          id: "30000000-0000-4000-8000-000000000101",
          tenantId: TENANT_ID,
          normalizedEmail: String(input.normalizedEmail),
          displayEmail: String(input.displayEmail),
          partnerType: input.partnerType,
          hostname: String(input.hostname),
          selector: String(input.selector),
          tokenHash: String(input.tokenHash),
          expiresAt: input.expiresAt,
          consumedAt: null,
          revokedAt: null,
          completedPartnerId: null,
          createdAt: NOW,
        };
      },
    },
    partnerRegistrationNotifier: {
      async appendVerificationRequested(input: Record<string, unknown>) {
        notificationInput = input;
        events.push("notification");
      },
    },
    partnerSecurityAudit: {
      async append(input: Record<string, unknown>) {
        auditInput = input;
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
    issue(purpose: string) {
      events.push(`token:${purpose}`);
      return {
        selector: "partner-selector",
        serialized: "partner-registration.raw-secret",
        tokenHash: "a".repeat(64),
      };
    },
    derive() {
      throw new Error("not used");
    },
    verify() {
      throw new Error("not used");
    },
  };

  return {
    auditInput: () => auditInput,
    challengeInput: () => challengeInput,
    events,
    notificationInput: () => notificationInput,
    oneTimeTokens,
    transactions,
  };
}

test("registration start stores only selector/digest and emits the raw token only at the notification boundary", async () => {
  const harness = createHarness();
  const useCase = new StartPartnerRegistrationUseCase(harness.transactions, harness.oneTimeTokens);

  const result = await useCase.execute({
    context: CONTEXT,
    hostname: "studiohub.example.test",
    email: "  Partner@Example.TEST  ",
    partnerType: "company",
    now: NOW,
  });

  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(harness.events, [
    "token:partner_registration",
    "eligibility",
    "challenge",
    "notification",
  ]);

  const challenge = harness.challengeInput();
  assert.ok(challenge);
  assert.equal(challenge.normalizedEmail, "partner@example.test");
  assert.equal(challenge.displayEmail, "Partner@Example.TEST");
  assert.equal(challenge.hostname, "studiohub.example.test");
  assert.equal(challenge.selector, "partner-selector");
  assert.equal(challenge.tokenHash, "a".repeat(64));
  assert.ok(challenge.expiresAt instanceof Date);
  assert.ok(challenge.expiresAt.getTime() > NOW.getTime());
  assert.equal("serializedToken" in challenge, false);
  assert.equal("serialized" in challenge, false);

  const notification = harness.notificationInput();
  assert.ok(notification);
  assert.equal(notification.normalizedEmail, "partner@example.test");
  assert.equal(notification.hostname, "studiohub.example.test");
  assert.equal(notification.serializedToken, "partner-registration.raw-secret");
});

test("registration start keeps the public response enumeration-safe", async () => {
  const cases = [
    {
      email: "new@example.test",
      options: {},
    },
    {
      email: "existing@example.test",
      options: {
        eligibility: {
          eligible: true as const,
          tenantMembershipId: TENANT_MEMBERSHIP_ID,
        },
      },
    },
    {
      email: "existing-partner@example.test",
      options: {
        eligibility: {
          eligible: true as const,
          tenantMembershipId: TENANT_MEMBERSHIP_ID,
        },
        existingPartner: true,
      },
    },
    {
      email: "blocked@example.test",
      options: {
        eligibility: {
          eligible: false as const,
          reason: "identity_unavailable" as const,
        },
      },
    },
  ];

  for (const entry of cases) {
    const harness = createHarness(entry.options);
    const useCase = new StartPartnerRegistrationUseCase(
      harness.transactions,
      harness.oneTimeTokens,
    );
    const result = await useCase.execute({
      context: CONTEXT,
      hostname: "studiohub.example.test",
      email: entry.email,
      partnerType: "individual",
      now: NOW,
    });
    assert.deepEqual(result, { accepted: true });
  }
});

test("registration start creates a usable challenge for an existing eligible user without a Partner", async () => {
  const harness = createHarness({
    eligibility: {
      eligible: true,
      tenantMembershipId: TENANT_MEMBERSHIP_ID,
    },
    existingPartner: false,
  });
  const useCase = new StartPartnerRegistrationUseCase(harness.transactions, harness.oneTimeTokens);

  await useCase.execute({
    context: CONTEXT,
    hostname: "studiohub.example.test",
    email: "existing@example.test",
    partnerType: "company",
    now: NOW,
  });

  assert.ok(harness.challengeInput());
  assert.ok(harness.notificationInput());
  assert.deepEqual(harness.events, [
    "token:partner_registration",
    "eligibility",
    "partner-membership-probe",
    "challenge",
    "notification",
  ]);
});

test("registration start suppresses challenge delivery for blocked or existing-Partner identities", async () => {
  const cases: readonly HarnessOptions[] = [
    {
      eligibility: {
        eligible: false,
        reason: "identity_unavailable",
      },
    },
    {
      eligibility: {
        eligible: true,
        tenantMembershipId: TENANT_MEMBERSHIP_ID,
      },
      existingPartner: true,
    },
  ];

  for (const options of cases) {
    const harness = createHarness(options);
    const useCase = new StartPartnerRegistrationUseCase(
      harness.transactions,
      harness.oneTimeTokens,
    );

    const result = await useCase.execute({
      context: CONTEXT,
      hostname: "studiohub.example.test",
      email: "suppressed@example.test",
      partnerType: "company",
      now: NOW,
    });

    assert.deepEqual(result, { accepted: true });
    assert.equal(harness.challengeInput(), undefined);
    assert.equal(harness.notificationInput(), undefined);
    assert.equal(harness.events[0], "token:partner_registration");

    const audit = harness.auditInput();
    assert.ok(audit);
    assert.deepEqual(audit.metadata, {
      result: "accepted",
      reason: "policy_suppressed",
    });
    assert.equal(JSON.stringify(audit).includes("suppressed@example.test"), false);
    assert.equal(JSON.stringify(audit).includes("partner-registration.raw-secret"), false);
  }
});

test("registration start audits only bounded result and reason metadata", async () => {
  const harness = createHarness();
  const useCase = new StartPartnerRegistrationUseCase(harness.transactions, harness.oneTimeTokens);

  await useCase.execute({
    context: CONTEXT,
    hostname: "studiohub.example.test",
    email: "Partner@Example.TEST",
    partnerType: "company",
    now: NOW,
  });

  const audit = harness.auditInput();
  assert.ok(audit);
  assert.deepEqual(audit, {
    eventType: "partner.registration.started",
    actorUserId: null,
    subjectUserId: null,
    requestId: CONTEXT.requestId,
    metadata: {
      result: "accepted",
      reason: "verification_requested",
    },
    occurredAt: NOW,
  });
  assert.equal(JSON.stringify(audit).includes("partner@example.test"), false);
  assert.equal(JSON.stringify(audit).includes("partner-registration.raw-secret"), false);
});
