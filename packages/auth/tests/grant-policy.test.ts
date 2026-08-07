import assert from "node:assert/strict";
import test from "node:test";

import { canGrantRole, type GrantAction, SYSTEM_ROLES, type SystemRole } from "../src/index.js";

interface GrantCase {
  readonly name: string;
  readonly actorRoles: readonly SystemRole[];
  readonly targetCurrentRoles: readonly SystemRole[];
  readonly requestedRole: SystemRole;
  readonly action: GrantAction;
  readonly allowed: boolean;
}

const cases: readonly GrantCase[] = [
  {
    name: "platform admin may issue the initial owner invitation",
    actorRoles: [SYSTEM_ROLES.platformAdmin],
    targetCurrentRoles: [],
    requestedRole: SYSTEM_ROLES.tenantOwner,
    action: "invite",
    allowed: true,
  },
  {
    name: "platform admin cannot use the grant policy to invite a tenant admin",
    actorRoles: [SYSTEM_ROLES.platformAdmin],
    targetCurrentRoles: [],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "invite",
    allowed: false,
  },
  {
    name: "tenant owner may invite a tenant admin",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "invite",
    allowed: true,
  },
  {
    name: "tenant admin may invite another tenant admin",
    actorRoles: [SYSTEM_ROLES.tenantAdmin],
    targetCurrentRoles: [],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "invite",
    allowed: true,
  },
  {
    name: "tenant owner may promote an active tenant admin to owner",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [SYSTEM_ROLES.tenantAdmin],
    requestedRole: SYSTEM_ROLES.tenantOwner,
    action: "promote",
    allowed: true,
  },
  {
    name: "tenant admin cannot promote an owner",
    actorRoles: [SYSTEM_ROLES.tenantAdmin],
    targetCurrentRoles: [SYSTEM_ROLES.tenantAdmin],
    requestedRole: SYSTEM_ROLES.tenantOwner,
    action: "promote",
    allowed: false,
  },
  {
    name: "tenant owner may demote an owner to tenant admin",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [SYSTEM_ROLES.tenantOwner],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "demote",
    allowed: true,
  },
  {
    name: "tenant admin cannot demote an owner",
    actorRoles: [SYSTEM_ROLES.tenantAdmin],
    targetCurrentRoles: [SYSTEM_ROLES.tenantOwner],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "demote",
    allowed: false,
  },
  {
    name: "tenant owner may suspend a tenant admin",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [SYSTEM_ROLES.tenantAdmin],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "suspend",
    allowed: true,
  },
  {
    name: "tenant admin may suspend another tenant admin",
    actorRoles: [SYSTEM_ROLES.tenantAdmin],
    targetCurrentRoles: [SYSTEM_ROLES.tenantAdmin],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "suspend",
    allowed: true,
  },
  {
    name: "tenant admin cannot suspend an owner",
    actorRoles: [SYSTEM_ROLES.tenantAdmin],
    targetCurrentRoles: [SYSTEM_ROLES.tenantOwner],
    requestedRole: SYSTEM_ROLES.tenantOwner,
    action: "suspend",
    allowed: false,
  },
  {
    name: "tenant owner cannot suspend an owner without demoting first",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [SYSTEM_ROLES.tenantOwner],
    requestedRole: SYSTEM_ROLES.tenantOwner,
    action: "suspend",
    allowed: false,
  },
  {
    name: "tenant owner may revoke a tenant admin",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [SYSTEM_ROLES.tenantAdmin],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "revoke",
    allowed: true,
  },
  {
    name: "tenant admin may revoke another tenant admin",
    actorRoles: [SYSTEM_ROLES.tenantAdmin],
    targetCurrentRoles: [SYSTEM_ROLES.tenantAdmin],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "revoke",
    allowed: true,
  },
  {
    name: "tenant admin cannot revoke an owner",
    actorRoles: [SYSTEM_ROLES.tenantAdmin],
    targetCurrentRoles: [SYSTEM_ROLES.tenantOwner],
    requestedRole: SYSTEM_ROLES.tenantOwner,
    action: "revoke",
    allowed: false,
  },
  {
    name: "tenant owner cannot revoke an owner without demoting first",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [SYSTEM_ROLES.tenantOwner],
    requestedRole: SYSTEM_ROLES.tenantOwner,
    action: "revoke",
    allowed: false,
  },
  {
    name: "no actor role denies every operation",
    actorRoles: [],
    targetCurrentRoles: [SYSTEM_ROLES.tenantAdmin],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "revoke",
    allowed: false,
  },
  {
    name: "no tenant actor may grant platform admin",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [],
    requestedRole: SYSTEM_ROLES.platformAdmin,
    action: "invite",
    allowed: false,
  },
  {
    name: "platform admin cannot be altered through tenant grant policy",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [SYSTEM_ROLES.platformAdmin],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "revoke",
    allowed: false,
  },
  {
    name: "promotion requires a current tenant admin",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [],
    requestedRole: SYSTEM_ROLES.tenantOwner,
    action: "promote",
    allowed: false,
  },
  {
    name: "demotion requires a current tenant owner",
    actorRoles: [SYSTEM_ROLES.tenantOwner],
    targetCurrentRoles: [SYSTEM_ROLES.tenantAdmin],
    requestedRole: SYSTEM_ROLES.tenantAdmin,
    action: "demote",
    allowed: false,
  },
];

for (const grantCase of cases) {
  test(grantCase.name, () => {
    const decision = canGrantRole(grantCase);
    assert.equal(decision.allowed, grantCase.allowed);
  });
}
