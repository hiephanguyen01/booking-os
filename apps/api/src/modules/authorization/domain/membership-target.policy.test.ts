import assert from "node:assert/strict";
import test from "node:test";

import { membershipTargetAllowed } from "./membership-target.policy.js";

const OWNER = "tenant_owner" as const;
const ADMIN = "tenant_admin" as const;

test("membership target policy enforces owner/admin grant boundaries", () => {
  const matrix = [
    ["owner invites admin", true, { action: "invite", actorRoles: [OWNER], targetRoles: [] }],
    ["admin invites admin", true, { action: "invite", actorRoles: [ADMIN], targetRoles: [] }],
    [
      "owner promotes admin",
      true,
      { action: "promote", actorRoles: [OWNER], targetRoles: [ADMIN] },
    ],
    [
      "admin cannot promote",
      false,
      { action: "promote", actorRoles: [ADMIN], targetRoles: [ADMIN] },
    ],
    [
      "owner demotes owner with another owner",
      true,
      { action: "demote", actorRoles: [OWNER], targetRoles: [OWNER], activeOwnerCount: 2 },
    ],
    [
      "final owner cannot be demoted",
      false,
      { action: "demote", actorRoles: [OWNER], targetRoles: [OWNER], activeOwnerCount: 1 },
    ],
    [
      "admin can suspend another admin",
      true,
      { action: "suspend", actorRoles: [ADMIN], targetRoles: [ADMIN] },
    ],
    [
      "admin cannot suspend owner",
      false,
      { action: "suspend", actorRoles: [ADMIN], targetRoles: [OWNER] },
    ],
    [
      "owner can revoke admin",
      true,
      { action: "revoke", actorRoles: [OWNER], targetRoles: [ADMIN] },
    ],
    [
      "owner cannot revoke owner",
      false,
      { action: "revoke", actorRoles: [OWNER], targetRoles: [OWNER] },
    ],
  ] as const;

  for (const [name, expected, input] of matrix) {
    assert.equal(
      membershipTargetAllowed({
        actorMembershipId: "actor-membership",
        targetMembershipId: input.action === "invite" ? undefined : "target-membership",
        activeOwnerCount: "activeOwnerCount" in input ? input.activeOwnerCount : undefined,
        ...input,
      }),
      expected,
      name,
    );
  }
});

test("membership target policy rejects self-targeting lifecycle changes", () => {
  for (const action of ["suspend", "revoke"] as const) {
    assert.equal(
      membershipTargetAllowed({
        action,
        actorMembershipId: "same-membership",
        targetMembershipId: "same-membership",
        actorRoles: [OWNER],
        targetRoles: [ADMIN],
      }),
      false,
    );
  }
});
