import assert from "node:assert/strict";
import test from "node:test";

import { decryptSensitiveEnvelope } from "@booking-os/auth";

import { AesInitialOwnerOnboardingEnvelopeAdapter } from "./aes-membership-provisioning-envelope.adapter.js";

const ENVELOPE_KEY = new Uint8Array(32).fill(9);
const EVENT_ID = "70000000-0000-4000-8000-000000000001";
const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const INVITATION_ID = "50000000-0000-4000-8000-000000000001";
const USER_ID = "60000000-0000-4000-8000-000000000001";
const HOSTNAME = "acme.booking.localhost";
const RECIPIENT = "owner@example.test";
const ACTIVATION_TOKEN = "activation-secret";
const INVITATION_TOKEN = "invitation-secret";

test("seals both initial owner tokens in one context-bound encrypted envelope", () => {
  const adapter = new AesInitialOwnerOnboardingEnvelopeAdapter("v1", { v1: ENVELOPE_KEY });
  const envelope = adapter.seal({
    eventId: EVENT_ID,
    tenantId: TENANT_ID,
    invitationId: INVITATION_ID,
    userId: USER_ID,
    hostname: HOSTNAME,
    recipient: RECIPIENT,
    activationToken: ACTIVATION_TOKEN,
    invitationToken: INVITATION_TOKEN,
  });

  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes(ACTIVATION_TOKEN), false);
  assert.equal(serialized.includes(INVITATION_TOKEN), false);

  const plaintext = new TextDecoder().decode(
    decryptSensitiveEnvelope({
      envelope,
      keyring: { v1: ENVELOPE_KEY },
      aad: new TextEncoder().encode(
        [
          "booking-os:owner-onboarding-email:v1",
          "membership.owner_onboarding.requested.v1",
          EVENT_ID,
          TENANT_ID,
          INVITATION_ID,
          USER_ID,
          HOSTNAME,
          RECIPIENT,
        ].join("\0"),
      ),
    }),
  );

  assert.deepEqual(JSON.parse(plaintext), {
    activationToken: ACTIVATION_TOKEN,
    invitationToken: INVITATION_TOKEN,
  });
});
