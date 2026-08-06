import assert from "node:assert/strict";
import test from "node:test";

import { createCsrfNonce, deriveCsrfToken, verifyCsrfToken } from "../src/csrf-token.js";

const csrfKey = Buffer.alloc(32, 0x5a);
const nonce = createCsrfNonce((size) => Buffer.alloc(size, 0x11));

test("derives a deterministic token bound to exact host and session", () => {
  const token = deriveCsrfToken({
    csrfKey,
    sessionId: "session-1",
    hostname: "console.example.test",
    nonce,
  });

  assert.equal(
    verifyCsrfToken({
      csrfKey,
      sessionId: "session-1",
      hostname: "console.example.test",
      token,
    }),
    true,
  );
  assert.equal(
    verifyCsrfToken({
      csrfKey,
      sessionId: "session-2",
      hostname: "console.example.test",
      token,
    }),
    false,
  );
  assert.equal(
    verifyCsrfToken({
      csrfKey,
      sessionId: "session-1",
      hostname: "Console.example.test",
      token,
    }),
    false,
  );
  assert.equal(
    verifyCsrfToken({
      csrfKey,
      sessionId: "session-1",
      hostname: "console.example.test",
      token: `${token}x`,
    }),
    false,
  );
});
