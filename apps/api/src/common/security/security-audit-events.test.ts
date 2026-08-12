import assert from "node:assert/strict";
import test from "node:test";

import { SECURITY_AUDIT_EVENT_TYPES } from "./security-audit-events.js";

test("exposes only the approved canonical security audit event catalog", () => {
  assert.deepEqual(SECURITY_AUDIT_EVENT_TYPES, [
    "identity.user.provisioned",
    "identity.user.activated",
    "identity.password.changed",
    "identity.password.reset_requested",
    "identity.password.reset_completed",
    "identity.user.suspended",
    "session.created",
    "session.rotated",
    "session.revoked",
    "session.reuse_detected",
    "membership.invited",
    "membership.invitation_resent",
    "membership.accepted",
    "membership.suspended",
    "membership.revoked",
    "membership.owner_promoted",
    "membership.owner_demoted",
    "tenant.provisioned",
    "tenant.activated",
    "platform.bootstrap_admin_created",
    "authorization.denied",
  ]);
});
