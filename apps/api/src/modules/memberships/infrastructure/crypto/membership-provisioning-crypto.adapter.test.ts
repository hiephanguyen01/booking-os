import assert from "node:assert/strict";
import test from "node:test";

import { decryptSensitiveEnvelope } from "@booking-os/auth";

import {
  AesMembershipInvitationEnvelopeAdapter,
  AesTenantActivationEnvelopeAdapter,
} from "./aes-membership-provisioning-envelope.adapter.js";
import {
  HmacMembershipInvitationTokenAdapter,
  HmacTenantActivationTokenAdapter,
} from "./hmac-membership-provisioning-token.adapter.js";

const PEPPER = new Uint8Array(32).fill(7);
const ENVELOPE_KEY = new Uint8Array(32).fill(9);
const decoder = new TextDecoder();

const INVITATION_BINDING = Object.freeze({
  tenantId: "30000000-0000-4000-8000-000000000001",
  userId: "60000000-0000-4000-8000-000000000001",
  hostname: "acme.example.com",
  normalizedEmail: "owner@example.com",
  intendedRoleKey: "tenant_owner" as const,
});

test("issues owner invitation tokens bound to their tenant, user, hostname, email, and role", () => {
  const tokens = new HmacMembershipInvitationTokenAdapter(PEPPER);
  const issued = tokens.issue(INVITATION_BINDING);

  assert.match(issued.serialized, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.match(issued.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(issued.selector, "");
});

test("parses and verifies invitation tokens against the exact invitation binding", () => {
  const tokens = new HmacMembershipInvitationTokenAdapter(PEPPER);
  const issued = tokens.issue(INVITATION_BINDING);
  const parsed = tokens.parse(issued.serialized);

  assert.ok(parsed);
  assert.equal(parsed.selector, issued.selector);
  assert.equal(
    tokens.verify({
      secret: parsed.secret,
      expectedTokenHash: issued.tokenHash,
      ...INVITATION_BINDING,
    }),
    true,
  );
  assert.equal(
    tokens.verify({
      secret: parsed.secret,
      expectedTokenHash: issued.tokenHash,
      ...INVITATION_BINDING,
      hostname: "other.example.com",
    }),
    false,
  );
  assert.equal(tokens.parse("malformed-token"), null);
});

test("issues tenant activation tokens compatible with the identity activation purpose", () => {
  const tokens = new HmacTenantActivationTokenAdapter(PEPPER);
  const issued = tokens.issue({
    tenantId: "30000000-0000-4000-8000-000000000001",
    hostname: "acme.example.com",
  });

  assert.match(issued.serialized, /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.match(issued.tokenHash, /^[a-f0-9]{64}$/);
});

test("seals invitation and activation delivery material with context-bound envelopes", () => {
  const invitations = new AesMembershipInvitationEnvelopeAdapter("v1", { v1: ENVELOPE_KEY });
  const activations = new AesTenantActivationEnvelopeAdapter("v1", { v1: ENVELOPE_KEY });
  const invitation = invitations.seal({
    eventId: "70000000-0000-4000-8000-000000000001",
    tenantId: "30000000-0000-4000-8000-000000000001",
    invitationId: "50000000-0000-4000-8000-000000000001",
    userId: "60000000-0000-4000-8000-000000000001",
    hostname: "acme.example.com",
    normalizedEmail: "owner@example.com",
    intendedRoleKey: "tenant_owner",
    serializedToken: "secret-invitation-token",
  });
  const activation = activations.seal({
    eventId: "70000000-0000-4000-8000-000000000002",
    tenantId: "30000000-0000-4000-8000-000000000001",
    invitationId: "50000000-0000-4000-8000-000000000001",
    userId: "60000000-0000-4000-8000-000000000001",
    hostname: "acme.example.com",
    recipient: "owner@example.com",
    serializedToken: "secret-activation-token",
  });

  assert.equal(JSON.stringify(invitation).includes("secret-invitation-token"), false);
  assert.equal(JSON.stringify(activation).includes("secret-activation-token"), false);
  assert.equal(
    decoder.decode(
      decryptSensitiveEnvelope({
        envelope: activation,
        keyring: { v1: ENVELOPE_KEY },
        aad: new TextEncoder().encode(
          [
            "booking-os:identity-email:v1",
            "identity.activation.requested.v1",
            "70000000-0000-4000-8000-000000000002",
            "60000000-0000-4000-8000-000000000001",
            "acme.example.com",
            "owner@example.com",
            "account_activation",
          ].join("\0"),
        ),
      }),
    ),
    JSON.stringify({ token: "secret-activation-token" }),
  );
});
