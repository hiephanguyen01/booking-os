import assert from "node:assert/strict";
import test from "node:test";

import { classifyReadinessError } from "./readiness-failure.js";

test("classifies socket and PostgreSQL connection failures", () => {
  for (const code of [
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "EPIPE",
    "28P01",
    "08006",
  ]) {
    const error = Object.assign(new Error("internal dependency detail"), { code });
    assert.equal(classifyReadinessError(error), "connection_failed");
  }
});

test("classifies fixed Redis authentication prefixes", () => {
  assert.equal(
    classifyReadinessError(new Error("WRONGPASS invalid username-password pair")),
    "connection_failed",
  );
  assert.equal(
    classifyReadinessError(new Error("NOAUTH Authentication required")),
    "connection_failed",
  );
});

test("maps unrecognized failures to a safe fixed reason", () => {
  assert.equal(classifyReadinessError(new Error("parser failure")), "unexpected_response");
  assert.equal(classifyReadinessError("internal string"), "unexpected_response");
});
