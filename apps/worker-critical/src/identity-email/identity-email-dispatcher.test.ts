import assert from "node:assert/strict";
import test from "node:test";

import type { IdentityEmailMessage, IdentityEmailSender } from "./identity-email-dispatcher.js";
import { IdentityEmailDispatcher } from "./identity-email-dispatcher.js";
import { IdentityEmailDeliveryError } from "./identity-email-error.js";
import { createIdentityEmailJob, TOKEN } from "./test-fixtures.js";

test("sends activation and reset links with tokens only in URL fragments", async () => {
  const messages: IdentityEmailMessage[] = [];
  const sender: IdentityEmailSender = {
    async send(message) {
      messages.push(message);
    },
  };
  const dispatcher = new IdentityEmailDispatcher(sender, {
    "identity-v1": Buffer.alloc(32, 7),
  });

  const activation = createIdentityEmailJob();
  const reset = createIdentityEmailJob({
    eventType: "identity.password_reset.requested.v1",
    template: "password_reset",
  });
  await dispatcher.dispatch(activation.name, activation.data);
  await dispatcher.dispatch(reset.name, reset.data);

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.to, "owner@example.com");
  assert.match(
    messages[0]?.text ?? "",
    new RegExp(`https://console\\.example\\.com/activate#token=${TOKEN}`, "u"),
  );
  assert.match(
    messages[1]?.text ?? "",
    new RegExp(`https://console\\.example\\.com/password/reset#token=${TOKEN}`, "u"),
  );
  for (const message of messages) {
    assert.doesNotMatch(message.text, /\?token=/u);
    assert.doesNotMatch(message.text, /<img|https:\/\/[^\s]*tracking/iu);
  }
});

test("preserves retry classification while keeping token and transport details out of errors", async () => {
  const sender: IdentityEmailSender = {
    async send() {
      throw new IdentityEmailDeliveryError("identity_email.smtp_temporary", true);
    },
  };
  const dispatcher = new IdentityEmailDispatcher(sender, {
    "identity-v1": Buffer.alloc(32, 7),
  });
  const job = createIdentityEmailJob();

  await assert.rejects(
    dispatcher.dispatch(job.name, job.data),
    (error: unknown) => {
      assert.ok(error instanceof IdentityEmailDeliveryError);
      assert.equal(error.retryable, true);
      assert.equal(error.code, "identity_email.smtp_temporary");
      assert.doesNotMatch(error.message, new RegExp(TOKEN, "u"));
      assert.doesNotMatch(error.message, /ECONNREFUSED|smtp\.internal|ciphertext/iu);
      return true;
    },
  );
});
