import assert from "node:assert/strict";
import test from "node:test";

import { tenantSessionRevocationAllowed } from "./tenant-session-revocation.policy.js";

const OWNER = "tenant_owner" as const;
const ADMIN = "tenant_admin" as const;

test("tenant session revocation policy allows owner/admin only against another tenant admin", () => {
  const matrix = [
    ["owner revokes admin session", true, [OWNER], [ADMIN], "actor", "target"],
    ["admin revokes admin session", true, [ADMIN], [ADMIN], "actor", "target"],
    ["owner cannot revoke owner session", false, [OWNER], [OWNER], "actor", "target"],
    ["admin cannot revoke owner session", false, [ADMIN], [OWNER], "actor", "target"],
    ["admin cannot use admin policy on self", false, [ADMIN], [ADMIN], "same", "same"],
    ["platform role has no tenant grant", false, ["platform_admin"], [ADMIN], "actor", "target"],
    [
      "mixed platform and tenant roles fail closed",
      false,
      ["platform_admin", OWNER],
      [ADMIN],
      "actor",
      "target",
    ],
  ] as const;

  for (const [name, expected, actorRoles, targetRoles, actorUserId, targetUserId] of matrix) {
    assert.equal(
      tenantSessionRevocationAllowed({
        actorUserId,
        targetUserId,
        actorRoles,
        targetRoles,
      }),
      expected,
      name,
    );
  }
});
