import assert from "node:assert/strict";
import test from "node:test";

import { redactSensitiveData } from "../src/index.js";

const REDACTED = "[REDACTED]";

test("recursively redacts sensitive fields without hiding safe authorization metadata", () => {
  const input = {
    requestId: "req-1",
    authorizationVersion: 7,
    tokenCount: 2,
    errorCode: "identity_email.smtp_temporary",
    credentials: {
      password: "correct-horse-battery-staple",
      accessToken: "access-token",
      refresh_token: "refresh-token",
      clientSecret: "client-secret",
      nested: [
        {
          authorization: "Bearer secret",
          cookie: "session=opaque",
          "set-cookie": "session=opaque; HttpOnly",
          otp: "123456",
        },
      ],
    },
  };

  assert.deepEqual(redactSensitiveData(input), {
    requestId: "req-1",
    authorizationVersion: 7,
    tokenCount: 2,
    errorCode: "identity_email.smtp_temporary",
    credentials: {
      password: REDACTED,
      accessToken: REDACTED,
      refresh_token: REDACTED,
      clientSecret: REDACTED,
      nested: [
        {
          authorization: REDACTED,
          cookie: REDACTED,
          "set-cookie": REDACTED,
          otp: REDACTED,
        },
      ],
    },
  });
});

test("does not mutate the original value", () => {
  const input = {
    nested: {
      password: "secret",
      safe: "visible",
    },
  };

  const result = redactSensitiveData(input);

  assert.notEqual(result, input);
  assert.equal(input.nested.password, "secret");
  assert.equal(input.nested.safe, "visible");
});
