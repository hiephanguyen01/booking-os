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
  ["/platform/invitation-pending/status", invitationPending, true],
  ["/invite/accept", invitationPending, true],
  ["/invite/accept", platform, true],
  ["/tenant", tenant, true],
  ["/settings/members", tenant, true],
  ["/settings/members", platform, false],
  ["/tenant", invitationPending, false],
] as const;

for (const [pathname, session, expected] of cases) {
  test(`${pathname} access resolves to ${expected}`, () => {
    assert.equal(canAccessConsolePath(pathname, session), expected);
  });
}

test("middleware matcher protects the actual Task 8 page URLs", () => {
  assert.deepEqual(middlewareConfig.matcher, [
    "/api/:path*",
    "/platform/:path*",
    "/invite/:path*",
    "/tenant/:path*",
    "/settings/:path*",
  ]);
});
