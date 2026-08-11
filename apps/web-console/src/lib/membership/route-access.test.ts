import assert from "node:assert/strict";
import test from "node:test";

import { config as middlewareConfig } from "../../../middleware.js";
import { type ConsoleSessionSummary, canAccessConsolePath } from "./route-access.js";

const platform: ConsoleSessionSummary = {
  state: "active",
  scope: { type: "platform" },
};
const invitationPending: ConsoleSessionSummary = {
  state: "invitation_pending",
  scope: { type: "tenant", tenantId: "11111111-1111-4111-8111-111111111111" },
};
const tenant: ConsoleSessionSummary = {
  state: "active",
  scope: { type: "tenant", tenantId: "11111111-1111-4111-8111-111111111111" },
};

const cases = [
  ["/platform/create", platform, true],
  ["/platform/create", tenant, false],
  ["/platform/status", platform, true],
  ["/platform-shadow", platform, false],
  ["/tenant", tenant, true],
  ["/tenant-shadow", tenant, false],
  ["/settings/members", tenant, true],
  ["/settings/members", platform, false],
  ["/settings-shadow", tenant, false],
  ["/tenant", invitationPending, false],
  ["/unknown", platform, false],
] as const;

for (const [pathname, session, expected] of cases) {
  test(`${pathname} access resolves to ${expected}`, () => {
    assert.equal(canAccessConsolePath(pathname, session), expected);
  });
}

test("middleware matcher covers authenticated routes and request-bound auth-page CSP", () => {
  assert.deepEqual(middlewareConfig.matcher, [
    "/api/:path*",
    "/login",
    "/activate/:path*",
    "/password/:path*",
    "/invite/:path*",
    "/platform/:path*",
    "/tenant/:path*",
    "/settings/:path*",
  ]);
});

test("invitation acceptance shell passes through auth-page middleware for nonce CSP", () => {
  assert.equal(
    middlewareConfig.matcher.some((pattern) => pattern.startsWith("/invite")),
    true,
  );
});