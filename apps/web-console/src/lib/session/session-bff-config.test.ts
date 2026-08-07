import assert from "node:assert/strict";
import test from "node:test";

import { createSessionBffHandlers } from "./session-bff.js";

const fetchStub: typeof fetch = async () => new Response(null, { status: 500 });

for (const apiBaseUrl of [
  "http://api.example.test/api",
  "https://user:password@api.example.test/api",
  "https://api.example.test/api?tenant=attacker",
  "https://api.example.test/api#fragment",
]) {
  test(`rejects unsafe session API base URL: ${apiBaseUrl}`, () => {
    assert.throws(
      () => createSessionBffHandlers({ apiBaseUrl, fetch: fetchStub }),
      /canonical HTTPS URL|loopback HTTP URL/u,
    );
  });
}

test("allows loopback HTTP for local development", () => {
  assert.doesNotThrow(() =>
    createSessionBffHandlers({
      apiBaseUrl: "http://localhost:3001/api/",
      fetch: fetchStub,
    }),
  );
});
