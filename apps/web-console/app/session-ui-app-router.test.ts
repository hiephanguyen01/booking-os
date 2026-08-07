import assert from "node:assert/strict";
import test from "node:test";

test("login exposes an App Router page and same-origin BFF route", async () => {
  const page = await import("./login/page.js");
  const route = await import("./api/auth/login/route.js");

  assert.equal(typeof page.default, "function");
  assert.equal(typeof route.POST, "function");
});

test("session security exposes an App Router page", async () => {
  const page = await import("./security/sessions/page.js");

  assert.equal(typeof page.default, "function");
});
