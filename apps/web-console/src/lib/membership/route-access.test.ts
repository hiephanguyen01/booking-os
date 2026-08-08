import assert from "node:assert/strict";
import test from "node:test";

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
  ["/app/platform/create", platform, true],
  ["/app/platform/create", tenant, false],
  ["/app/platform/invitation-pending/status", invitationPending, true],
  ["/app/invite/accept", invitationPending, true],
  ["/app/invite/accept", platform, true],
  ["/app/tenant", tenant, true],
  ["/app/settings/members", tenant, true],
  ["/app/settings/members", platform, false],
  ["/app/tenant", invitationPending, false],
] as const;

for (const [pathname, session, expected] of cases) {
  test(`${pathname} access resolves to ${expected}`, () => {
    assert.equal(canAccessConsolePath(pathname, session), expected);
  });
}
