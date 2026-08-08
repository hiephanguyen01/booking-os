import assert from "node:assert/strict";
import test from "node:test";

import { isInvitationPendingRouteAllowed } from "./invitation-pending-route-policy.js";

const ALLOWED_ROUTES = Object.freeze([
  { method: "GET", path: "/auth/csrf" },
  { method: "GET", path: "/auth/me" },
  { method: "POST", path: "/auth/logout" },
  { method: "POST", path: "/auth/password/reset" },
  { method: "GET", path: "/membership/invitations/current" },
  { method: "POST", path: "/membership/invitations/accept" },
]);

test("allows only the explicit invitation-pending route surface", () => {
  for (const route of ALLOWED_ROUTES) {
    assert.equal(isInvitationPendingRouteAllowed(route), true, `${route.method} ${route.path}`);
  }
});

test("fails closed for normal, probe, prefix-confused, and wrong-method routes", () => {
  const denied = [
    { method: "GET", path: "/health" },
    { method: "GET", path: "/memberships" },
    { method: "POST", path: "/membership/invitations" },
    { method: "POST", path: "/auth/me" },
    { method: "GET", path: "/auth/logout" },
    { method: "GET", path: "/api/auth/me" },
    { method: "GET", path: "/probe/auth/me" },
    { method: "GET", path: "/auth/me/extra" },
  ] as const;

  for (const route of denied) {
    assert.equal(isInvitationPendingRouteAllowed(route), false, `${route.method} ${route.path}`);
  }
});
