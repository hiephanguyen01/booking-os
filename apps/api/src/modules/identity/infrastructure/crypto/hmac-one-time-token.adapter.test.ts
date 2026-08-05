import assert from "node:assert/strict";
import test from "node:test";

import { HmacOneTimeTokenAdapter } from "./hmac-one-time-token.adapter.js";

const PEPPER = Buffer.alloc(32, 7);

test("derives the selector and purpose-bound digest from serialized token material", () => {
  const adapter = new HmacOneTimeTokenAdapter(PEPPER);
  const issued = adapter.issue("identity.activation.v1:platform:-:console.example.com");

  const derived = adapter.derive(
    issued.serialized,
    "identity.activation.v1:platform:-:console.example.com",
  );

  assert.deepEqual(derived, {
    selector: issued.selector,
    tokenHash: issued.tokenHash,
  });
  assert.notEqual(
    adapter.derive(issued.serialized, "identity.password_reset.v1:platform:-:console.example.com")
      ?.tokenHash,
    issued.tokenHash,
  );
  assert.equal(adapter.derive("malformed", "identity.activation.v1"), null);
});
