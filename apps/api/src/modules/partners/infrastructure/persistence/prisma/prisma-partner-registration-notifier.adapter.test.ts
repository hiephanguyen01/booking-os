import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@prisma/client";

import type {
  SensitiveEnvelopePort,
  SensitiveEnvelopeValue,
} from "../../../../identity/application/ports/sensitive-envelope.port.js";
import { PrismaPartnerRegistrationNotifierAdapter } from "./prisma-partner-registration-notifier.adapter.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const CHALLENGE_ID = "30000000-0000-4000-8000-000000000101";
const EVENT_ID = "30000000-0000-4000-8000-000000000102";
const RAW_TOKEN = "partner-registration.raw-secret";
const NOW = new Date("2026-08-23T00:00:00.000Z");

const SEALED: SensitiveEnvelopeValue = Object.freeze({
  version: 1,
  keyId: "test-key",
  iv: "iv",
  ciphertext: "ciphertext",
  tag: "tag",
});

test("Partner registration notifier seals the raw token before persisting the outbox event", async () => {
  let persisted: Record<string, unknown> | undefined;
  let sealedPlaintext: string | undefined;
  let associatedData: string | undefined;

  const transaction = {
    outboxEvent: {
      async create(input: { readonly data: Record<string, unknown> }) {
        persisted = input.data;
        return input.data;
      },
    },
  } as unknown as Prisma.TransactionClient;

  const envelope: SensitiveEnvelopePort = {
    seal(plaintext: Uint8Array, aad: Uint8Array) {
      sealedPlaintext = new TextDecoder().decode(plaintext);
      associatedData = new TextDecoder().decode(aad);
      return SEALED;
    },
    open() {
      throw new Error("not used");
    },
  };

  const adapter = new PrismaPartnerRegistrationNotifierAdapter(
    transaction,
    TENANT_ID,
    envelope,
    () => EVENT_ID,
  );

  await adapter.appendVerificationRequested({
    challengeId: CHALLENGE_ID,
    normalizedEmail: "partner@example.test",
    displayEmail: "Partner@Example.TEST",
    serializedToken: RAW_TOKEN,
    hostname: "studiohub.example.test",
    occurredAt: NOW,
  });

  assert.equal(sealedPlaintext, JSON.stringify({ token: RAW_TOKEN }));
  assert.match(associatedData ?? "", /partner\.registration\.verification_requested/);
  assert.ok(persisted);
  assert.equal(JSON.stringify(persisted).includes(RAW_TOKEN), false);
  assert.equal(persisted.type, "partner.registration.verification_requested");
  assert.equal(persisted.aggregateId, CHALLENGE_ID);

  const payload = persisted.payload as Record<string, unknown>;
  assert.deepEqual(payload.envelope, SEALED);
  assert.equal(payload.recipient, "Partner@Example.TEST");
});
