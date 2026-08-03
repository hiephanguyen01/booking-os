import assert from "node:assert/strict";
import test from "node:test";

import {
  PERMISSIONS,
  ROLES,
  getPermissions,
  hasPermission,
  type Session,
} from "../src/index.js";

const platformSession: Session = {
  user: {
    id: "platform-user",
    email: "platform@example.com",
    displayName: "Platform Admin",
    role: ROLES.platformAdmin,
  },
  expiresAt: "2026-08-04T00:00:00.000Z",
};

const partnerSession: Session = {
  user: {
    id: "partner-user",
    email: "partner@example.com",
    displayName: "Partner User",
    role: ROLES.partner,
  },
  expiresAt: "2026-08-04T00:00:00.000Z",
};

test("platform admin has platform management permission", () => {
  assert.equal(hasPermission(platformSession, PERMISSIONS.platformManage), true);
});

test("partner does not have platform management permission", () => {
  assert.equal(hasPermission(partnerSession, PERMISSIONS.platformManage), false);
});

test("missing session has no booking permission", () => {
  assert.equal(hasPermission(null, PERMISSIONS.bookingView), false);
});

test("affiliate permissions are returned in stable order", () => {
  assert.deepEqual(getPermissions(ROLES.affiliate), [PERMISSIONS.affiliateView]);
});

test("permission arrays are fresh values", () => {
  const first = getPermissions(ROLES.partner);
  const second = getPermissions(ROLES.partner);

  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});
