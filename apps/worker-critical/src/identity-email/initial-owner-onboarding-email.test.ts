import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv } from "node:crypto";

import type { IdentityEmailMessage, IdentityEmailSender } from "./identity-email-dispatcher.js";
import { IdentityEmailDispatcher } from "./identity-email-dispatcher.js";
import { parseIdentityEmailEvent } from "./identity-email-event.js";
import { decryptIdentityEmailMaterial } from "./sensitive-envelope.js";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const INVITATION_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const HOSTNAME = "acme.booking.localhost";
const RECIPIENT = "owner@example.test";
const ACTIVATION_TOKEN = `${"a".repeat(22)}.${"b".repeat(43)}`;
const INVITATION_TOKEN = `${"c".repeat(22)}.${"d".repeat(43)}`;
const KEY_ID = "identity-v1";
const KEY = Buffer.alloc(32, 7);

function createOnboardingJob() {
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv, { authTagLength: 16 });
  cipher.setAAD(
    Buffer.from(
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
      "utf8",
    ),
  );
  const ciphertext = Buffer.concat([
    cipher.update(
      Buffer.from(JSON.stringify({ activationToken: ACTIVATION_TOKEN, invitationToken: INVITATION_TOKEN })),
    ),
    cipher.final(),
  ]);

  return {
    name: "membership.owner_onboarding.requested.v1",
    data: {
      eventId: EVENT_ID,
      tenantId: TENANT_ID,
      aggregateType: "membership_invitation",
      aggregateId: INVITATION_ID,
      payload: {
        version: 1,
        recipient: RECIPIENT,
        hostname: HOSTNAME,
        purpose: "initial_owner_onboarding",
        tenantId: TENANT_ID,
        invitationId: INVITATION_ID,
        userId: USER_ID,
        envelope: {
          version: 1,
          keyId: KEY_ID,
          iv: iv.toString("base64url"),
          ciphertext: ciphertext.toString("base64url"),
          tag: cipher.getAuthTag().toString("base64url"),
        },
      },
    },
  } as const;
}

test("parses and decrypts both owner onboarding tokens", () => {
  const job = createOnboardingJob();
  const event = parseIdentityEmailEvent(job.name, job.data);

  assert.equal(event.template, "initial_owner_onboarding");
  assert.equal(event.tenantId, TENANT_ID);
  assert.equal(event.invitationId, INVITATION_ID);
  assert.deepEqual(decryptIdentityEmailMaterial(event, { [KEY_ID]: KEY }), {
    activationToken: ACTIVATION_TOKEN,
    invitationToken: INVITATION_TOKEN,
  });
});

test("sends one initial-owner onboarding message with fragment-only continuation", async () => {
  const messages: IdentityEmailMessage[] = [];
  const sender: IdentityEmailSender = {
    async send(message) {
      messages.push(message);
    },
  };
  const dispatcher = new IdentityEmailDispatcher(sender, { [KEY_ID]: KEY });
  const job = createOnboardingJob();

  await dispatcher.dispatch(job.name, job.data);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.subject, "Set up your Booking OS workspace");
  assert.match(
    messages[0]?.text ?? "",
    new RegExp(`#activation=${ACTIVATION_TOKEN}&invitation=${INVITATION_TOKEN}`, "u"),
  );
  assert.doesNotMatch(messages[0]?.text ?? "", /\?activation=|\?invitation=/u);
});
