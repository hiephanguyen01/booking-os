import assert from "node:assert/strict";
import test from "node:test";

import { IdentityEmailDeliveryError } from "./identity-email-error.js";
import { parseIdentityEmailEvent } from "./identity-email-event.js";
import { decryptIdentityEmailToken } from "./sensitive-envelope.js";
import { createIdentityEmailJob, KEY, TOKEN } from "./test-fixtures.js";

test("reconstructs AAD and decrypts the one-time token only in memory", () => {
  const job = createIdentityEmailJob();
  const event = parseIdentityEmailEvent(job.name, job.data);

  const token = decryptIdentityEmailToken(event, job.keyring);

  assert.equal(token, TOKEN);
});

test("maps unknown keys, tampering, and malformed plaintext to one permanent redacted error", () => {
  const wrongKey = createIdentityEmailJob({ keyId: "identity-v2" });
  const tampered = createIdentityEmailJob();
  const malformed = createIdentityEmailJob({ token: "not-a-token" });
  const tamperedJob = {
    ...tampered,
    data: {
      ...tampered.data,
      payload: {
        ...tampered.data.payload,
        envelope: {
          ...tampered.data.payload.envelope,
          ciphertext: `${tampered.data.payload.envelope.ciphertext.slice(0, -1)}A`,
        },
      },
    },
  };
  const cases = [
    {
      job: wrongKey,
      keyring: { "identity-v1": KEY },
    },
    {
      job: tamperedJob,
      keyring: tampered.keyring,
    },
    {
      job: malformed,
      keyring: malformed.keyring,
    },
  ];

  for (const item of cases) {
    const event = parseIdentityEmailEvent(item.job.name, item.job.data);
    assert.throws(
      () => decryptIdentityEmailToken(event, item.keyring),
      (error: unknown) => {
        assert.ok(error instanceof IdentityEmailDeliveryError);
        assert.equal(error.code, "identity_email.envelope_invalid");
        assert.equal(error.retryable, false);
        assert.equal(error.message, "identity_email.envelope_invalid");
        assert.doesNotMatch(JSON.stringify(error), /not-a-token|ciphertext|aaaa/u);
        return true;
      },
    );
  }
});
