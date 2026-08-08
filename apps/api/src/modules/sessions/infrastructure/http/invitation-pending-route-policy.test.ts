import assert from "node:assert/strict";
import test from "node:test";

import { isInvitationPendingRouteAllowed } from "./invitation-pending-route-policy.js";

const ALLOWED = [
  ["GET", "/auth/csrf"],
  ["GET", "/auth/me"],
  ["POST", "/auth/logout"],
  ["POST", "/auth/password/reset"],
  ["GET", "/membership/invitations/current"],
  ["POST", "/membership/invitations/accept"],
] as const;

test("admits only the explicit invitation-pending route allowlist", () => {
  for (const [method, path] of ALLOWED) {
    assert.equal(
      isInvitationPendingRouteAllowed({ method, path }),
      true,
      `${method} ${path} should be admitted`,
    );
  }
});

test("rejects normal membership, invitation mutation, and probe routes", () => {
  for (const [method, path] of [
    ["GET", "/memberships"],
    ["POST", "/membership/invitations"],
    ["POST", "/membership/invitations/invitation-1/resend"],
    ["GET", "/health"],
    ["GET", "/ready"],
    ["GET", "/platform/tenants"],
  ] as const) {
    assert.equal(
      isInvitationPendingRouteAllowed({ method, path }),
      false,
      `${method} ${path} should be denied`,
    );
  }
});

test("matches method and path exactly instead of widening the pending-session surface", () => {
  for (const [method, path] of [
    ["POST", "/auth/me"],
    ["GET", "/auth/logout"],
    ["GET", "/auth/password/reset"],
    ["POST", "/membership/invitations/current"],
    ["GET", "/membership/invitations/accept"],
    ["GET", "/membership/invitations/current/extra"],
  ] as const) {
    assert.equal(isInvitationPendingRouteAllowed({ method, path }), false);
  }
});
