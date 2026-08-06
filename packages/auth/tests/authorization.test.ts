import assert from "node:assert/strict";
import test from "node:test";

import { getPermissions, hasPermission, PERMISSIONS, ROLES } from "../src/index.js";

test("platform admin has platform management permission", () => {
  assert.equal(hasPermission(ROLES.platformAdmin, PERMISSIONS.platformManage), true);
});

test("partner does not have platform management permission", () => {
  assert.equal(hasPermission(ROLES.partner, PERMISSIONS.platformManage), false);
});

test("missing role has no booking permission", () => {
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
