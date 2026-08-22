import assert from "node:assert/strict";
import test from "node:test";

import type { TenantExecutionContext } from "@booking-os/contracts";

import type { OneTimeTokenPort } from "../../../identity/application/ports/one-time-token.port.js";
import type { PartnerDataSession } from "../ports/partner-data-session.js";
import type { PartnerTransactionPort } from "../ports/partner-transaction.port.js";
import { StartPartnerRegistrationUseCase } from "./start-partner-registration.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-23T00:00:00.000Z");
const CONTEXT: TenantExecutionContext = {
  tenantId: TENANT_ID,
  requestId: "req-partner-registration-start",
  traceId: "trace-partner-registration-start",
  source: "storefront",
};

function createHarness() {
  const events: string[] = [];
  let challengeInput: Record<string, unknown> | undefined;
  let notificationInput: Record<string, unknown> | undefined;

  const session = {
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
  } as unknown as PartnerDataSession;

  const transactions: PartnerTransactionPort = {
    async run<T>(context: TenantExecutionContext, work: (session: PartnerDataSession) => Promise<T>) {
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
  assert.deepEqual(harness.events, ["token:partner_registration", "challenge", "notification"]);

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
  for (const email of [
    "new@example.test",
    "existing@example.test",
    "existing-partner@example.test",
    "blocked@example.test",
  ]) {
    const harness = createHarness();
    const useCase = new StartPartnerRegistrationUseCase(harness.transactions, harness.oneTimeTokens);
    const result = await useCase.execute({
      context: CONTEXT,
      hostname: "studiohub.example.test",
      email,
      partnerType: "individual",
      now: NOW,
    });
    assert.deepEqual(result, { accepted: true });
  }
});
