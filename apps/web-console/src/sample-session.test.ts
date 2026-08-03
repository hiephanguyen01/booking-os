import assert from "node:assert/strict";
import test from "node:test";

import { hasPermission, PERMISSIONS, ROLES } from "@booking-os/auth";

import { samplePartnerSession } from "./sample-session.js";

test("sample console session uses the partner role", () => {
  assert.equal(samplePartnerSession.user.id, "partner-demo");
  assert.equal(samplePartnerSession.user.role, ROLES.partner);
});

test("sample partner can manage listings", () => {
  assert.equal(hasPermission(samplePartnerSession, PERMISSIONS.listingManage), true);
});

test("sample partner cannot manage the platform", () => {
  assert.equal(hasPermission(samplePartnerSession, PERMISSIONS.platformManage), false);
});
