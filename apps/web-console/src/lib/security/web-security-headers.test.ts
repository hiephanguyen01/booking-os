import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../../../next.config.js";

test("auth-page CSP is request-bound in middleware instead of duplicated statically", () => {
  assert.equal(nextConfig.headers, undefined);
});
