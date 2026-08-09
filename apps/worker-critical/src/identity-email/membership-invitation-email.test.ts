import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import test from "node:test";

import type { IdentityEmailMessage, IdentityEmailSender } from "./identity-email-dispatcher.js";
import { IdentityEmailDispatcher } from "./identity-email-dispatcher.js";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const INVITATION_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const HOSTNAME = "acme.example.com";
const RECIPIENT = "admin@example.com";
const TOKEN = `${"a".repeat(22)}.${"b".repeat(43)}`;
const KEY_ID = "identity-v1";
const KEY = Buffer.alloc(32, 7);

function createMembershipInvitationJob(
  eventType:
    | "membership.admin_invitation.requested.v1"
    | "membership.owner_invitation.requested.v1" = "membership.admin_invitation.requested.v1",
  intendedRoleKey: "tenant_admin" | "tenant_owner" = "tenant_admin",
) {
  const iv = Buffer.alloc(12, 5);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv, { authTagLength: 16 });
  cipher.setAAD(
    Buffer.from(
      [
        "booking-os:membership-email:v1",
        eventType,
        EVENT_ID,
        TENANT_ID,
        INVITATION_ID,
        USER_ID,
        HOSTNAME,
        RECIPIENT,
        intendedRoleKey,
      ].join("\0"),
      "utf8",
    ),
  );
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify({ token: TOKEN }), "utf8")),
    cipher.final(),
  ]);

  return {
    name: eventType,
    data: {
      eventId: EVENT_ID,
      tenantId: TENANT_ID,
      aggregateType: "membership_invitation",
      aggregateId: INVITATION_ID,
      payload: {
        version: 1,
        recipient: RECIPIENT,
        hostname: HOSTNAME,
        purpose: "membership_invitation",
        userId: USER_ID,
        intendedRoleKey,
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

test("decrypts membership invitation before building a fragment-only acceptance link", async () => {
  const messages: IdentityEmailMessage[] = [];
  const sender: IdentityEmailSender = {
    async send(message) {
      messages.push(message);
    },
  };
  const dispatcher = new IdentityEmailDispatcher(sender, { [KEY_ID]: KEY });
  const job = createMembershipInvitationJob();

  await dispatcher.dispatch(job.name, job.data);

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.to, RECIPIENT);
  assert.match(
    messages[0]?.text ?? "",
    new RegExp(`https://acme\\.example\\.com/invite/accept#token=${TOKEN}`, "u"),
  );
  assert.doesNotMatch(messages[0]?.text ?? "", /\?token=/u);
  assert.equal(JSON.stringify(job.data).includes(TOKEN), false);
});

test("dispatches a platform owner invitation with its owner-bound envelope", async () => {
  const messages: IdentityEmailMessage[] = [];
  const sender: IdentityEmailSender = {
    async send(message) {
      messages.push(message);
    },
  };
  const dispatcher = new IdentityEmailDispatcher(sender, { [KEY_ID]: KEY });
  const job = createMembershipInvitationJob(
    "membership.owner_invitation.requested.v1",
    "tenant_owner",
  );

  await dispatcher.dispatch(job.name, job.data);

  assert.equal(messages.length, 1);
  assert.match(
    messages[0]?.text ?? "",
    new RegExp(`https://acme\\.example\\.com/invite/accept#token=${TOKEN}`, "u"),
  );
  assert.doesNotMatch(messages[0]?.text ?? "", /\?token=/u);
});
