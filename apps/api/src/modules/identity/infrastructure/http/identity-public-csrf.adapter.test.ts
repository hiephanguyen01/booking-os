import assert from "node:assert/strict";
import test from "node:test";

import {
  IdentityCsrfInvalidError,
  IdentityPublicCsrfAdapter,
} from "./identity-public-csrf.adapter.js";
import { PreAuthCsrfService } from "./pre-auth-csrf.js";

const NOW = new Date("2026-08-05T12:30:00.000Z");

function createAdapter(): IdentityPublicCsrfAdapter {
  return new IdentityPublicCsrfAdapter(
    new PreAuthCsrfService({
      secret: Buffer.alloc(32, 7),
      now: () => NOW,
      randomBytes: () => Buffer.alloc(32, 9),
    }),
  );
}

test("accepts only an exact same-origin request with the issued nonce and proof", () => {
  const adapter = createAdapter();
  const issued = adapter.issue({
    hostname: "console.example.test",
    purpose: "activation",
  });

  assert.doesNotThrow(() =>
    adapter.assertRequest(
      {
        hostname: "console.example.test",
        expectedOrigin: "https://console.example.test",
        origin: "https://console.example.test",
        csrfCookie: issued.cookie.value,
        csrfToken: issued.token,
        requestId: "request-1",
      },
      "activation",
    ),
  );
});

test("rejects foreign origins, missing material, and invalid purpose bindings uniformly", () => {
  const adapter = createAdapter();
  const issued = adapter.issue({
    hostname: "console.example.test",
    purpose: "password_reset",
  });

  const invalidRequests = [
    {
      hostname: "console.example.test",
      expectedOrigin: "https://console.example.test",
      origin: "https://attacker.example.test",
      csrfCookie: issued.cookie.value,
      csrfToken: issued.token,
      requestId: "request-1",
    },
    {
      hostname: "console.example.test",
      expectedOrigin: "https://console.example.test",
      origin: "https://console.example.test",
      csrfCookie: null,
      csrfToken: issued.token,
      requestId: "request-1",
    },
    {
      hostname: "console.example.test",
      expectedOrigin: "https://console.example.test",
      origin: "https://console.example.test",
      csrfCookie: issued.cookie.value,
      csrfToken: issued.token,
      requestId: "request-1",
    },
  ] as const;

  for (const [index, request] of invalidRequests.entries()) {
    assert.throws(
      () => adapter.assertRequest(request, index === 2 ? "activation" : "password_reset"),
      (error: unknown) => {
        assert.ok(error instanceof IdentityCsrfInvalidError);
        assert.equal(error.code, "identity.csrf.invalid");
        assert.equal(error.statusCode, 403);
        assert.doesNotMatch(error.message, /attacker|nonce|proof|token/iu);
        return true;
      },
    );
  }
});
