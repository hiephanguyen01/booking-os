import assert from "node:assert/strict";
import test from "node:test";

import { isValidRequestId, selectRequestId } from "./request-id.js";

test("accepts the safe request ID grammar and boundary length", () => {
  assert.equal(isValidRequestId("gateway.id_1:part-2"), true);
  assert.equal(isValidRequestId("a".repeat(128)), true);
});

test("rejects empty, oversized, whitespace, control, and Unicode request IDs", () => {
  for (const value of ["", "a".repeat(129), "has space", "line\nbreak", "unicode-đ"]) {
    assert.equal(isValidRequestId(value), false);
  }
});

test("preserves a valid upstream ID without calling the generator", () => {
  let generatorCalls = 0;
  const result = selectRequestId("valid-id", () => {
    generatorCalls += 1;
    return "generated-id";
  });

  assert.equal(result, "valid-id");
  assert.equal(generatorCalls, 0);
});

test("generates an ID for missing or invalid headers", () => {
  assert.equal(
    selectRequestId(undefined, () => "generated-id"),
    "generated-id",
  );
  assert.equal(
    selectRequestId("bad value", () => "generated-id"),
    "generated-id",
  );
  assert.equal(
    selectRequestId(["bad value", "valid-id"], () => "generated-id"),
    "generated-id",
  );
});
