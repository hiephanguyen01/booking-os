import assert from "node:assert/strict";
import test from "node:test";

import { IdentityEmailDeliveryError } from "./identity-email-error.js";
import { parseIdentityEmailEvent } from "./identity-email-event.js";
import { createIdentityEmailJob, EVENT_ID, HOSTNAME, RECIPIENT, USER_ID } from "./test-fixtures.js";

test("parses the approved versioned activation event without exposing envelope bytes", () => {
  const job = createIdentityEmailJob();

  const event = parseIdentityEmailEvent(job.name, job.data);

  assert.equal(event.eventId, EVENT_ID);
  assert.equal(event.eventType, "identity.activation.requested.v1");
  assert.equal(event.userId, USER_ID);
  assert.equal(event.recipient, RECIPIENT);
  assert.equal(event.hostname, HOSTNAME);
  assert.equal(event.template, "account_activation");
  assert.equal(event.envelope.keyId, "identity-v1");
});

test("rejects unknown versions and event-template mismatches as permanent sanitized errors", () => {
  const cases = [
    createIdentityEmailJob({ payloadVersion: 2 }),
    createIdentityEmailJob({ template: "password_reset" }),
  ];

  for (const job of cases) {
    assert.throws(
      () => parseIdentityEmailEvent(job.name, job.data),
      (error: unknown) => {
        assert.ok(error instanceof IdentityEmailDeliveryError);
        assert.equal(error.retryable, false);
        assert.match(error.code, /^identity_email\./u);
        assert.doesNotMatch(error.message, /ciphertext|owner@example|aaaa/u);
        return true;
      },
    );
  }
});
