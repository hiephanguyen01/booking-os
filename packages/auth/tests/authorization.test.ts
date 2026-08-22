import assert from "node:assert/strict";
import test from "node:test";

import { getPermissions, hasPermission, PERMISSION_KEYS, SYSTEM_ROLES } from "../src/index.js";

test("system role catalog contains only the approved immutable roles", () => {
  assert.deepEqual(SYSTEM_ROLES, {
    platformAdmin: "platform_admin",
    tenantOwner: "tenant_owner",
    tenantAdmin: "tenant_admin",
    partnerOwner: "partner_owner",
    partnerAdmin: "partner_admin",
  });
  assert.equal("affiliate" in SYSTEM_ROLES, false);
});

test("permission catalog preserves prior keys and appends only approved Sprint 3 Partner keys", () => {
  assert.deepEqual(PERMISSION_KEYS, {
    platformSecurityAuditRead: "platform.security.audit.read",
    platformSecuritySessionRevoke: "platform.security.session.revoke",
    platformTenantsProvision: "platform.tenants.provision",
    platformUsersProvision: "platform.users.provision",
    tenantMembershipRead: "tenant.membership.read",
    tenantMembershipAdminInvite: "tenant.membership.admin.invite",
    tenantMembershipAdminSuspend: "tenant.membership.admin.suspend",
    tenantMembershipAdminRevoke: "tenant.membership.admin.revoke",
    tenantMembershipOwnerPromote: "tenant.membership.owner.promote",
    tenantMembershipOwnerDemote: "tenant.membership.owner.demote",
    tenantSecuritySessionRead: "tenant.security.session.read",
    tenantSecuritySessionRevoke: "tenant.security.session.revoke",
    tenantRbacPermissionRead: "tenant.rbac.permission.read",
    tenantRbacRoleRead: "tenant.rbac.role.read",
    tenantRbacRoleCreate: "tenant.rbac.role.create",
    tenantRbacRoleUpdate: "tenant.rbac.role.update",
    tenantRbacRoleArchive: "tenant.rbac.role.archive",
    tenantRbacRolePermissionGrant: "tenant.rbac.role.permission.grant",
    tenantRbacRolePermissionRevoke: "tenant.rbac.role.permission.revoke",
    tenantRbacAssignmentRead: "tenant.rbac.assignment.read",
    tenantRbacAssignmentGrant: "tenant.rbac.assignment.grant",
    tenantRbacAssignmentRevoke: "tenant.rbac.assignment.revoke",
    partnerProfileRead: "partner.profile.read",
    partnerProfileUpdate: "partner.profile.update",
    partnerApplicationRead: "partner.application.read",
    partnerApplicationSubmit: "partner.application.submit",
    partnerVerificationRead: "partner.verification.read",
    partnerVerificationUpdate: "partner.verification.update",
    partnerPayoutAccountRead: "partner.payout_account.read",
    partnerPayoutAccountUpdate: "partner.payout_account.update",
    partnerReviewFindingRead: "partner.review_finding.read",
    tenantPartnerRead: "tenant.partner.read",
    tenantPartnerVerificationRead: "tenant.partner.verification.read",
    tenantPartnerPayoutAccountRead: "tenant.partner.payout_account.read",
    tenantPartnerApplicationReview: "tenant.partner.application.review",
    tenantPartnerApplicationApprove: "tenant.partner.application.approve",
    tenantPartnerApplicationReject: "tenant.partner.application.reject",
    tenantPartnerLifecycleSuspend: "tenant.partner.lifecycle.suspend",
    tenantPartnerLifecycleReactivate: "tenant.partner.lifecycle.reactivate",
    tenantPartnerLifecycleCancel: "tenant.partner.lifecycle.cancel",
  });
});

test("platform administrator receives only platform permissions", () => {
  assert.deepEqual(getPermissions(SYSTEM_ROLES.platformAdmin), [
    PERMISSION_KEYS.platformSecurityAuditRead,
    PERMISSION_KEYS.platformSecuritySessionRevoke,
    PERMISSION_KEYS.platformTenantsProvision,
    PERMISSION_KEYS.platformUsersProvision,
  ]);
});

test("tenant owner receives prior tenant authority plus full Sprint 3 Partner governance", () => {
  assert.deepEqual(getPermissions(SYSTEM_ROLES.tenantOwner), [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantMembershipAdminInvite,
    PERMISSION_KEYS.tenantMembershipAdminSuspend,
    PERMISSION_KEYS.tenantMembershipAdminRevoke,
    PERMISSION_KEYS.tenantMembershipOwnerPromote,
    PERMISSION_KEYS.tenantMembershipOwnerDemote,
    PERMISSION_KEYS.tenantSecuritySessionRead,
    PERMISSION_KEYS.tenantSecuritySessionRevoke,
    PERMISSION_KEYS.tenantRbacPermissionRead,
    PERMISSION_KEYS.tenantRbacRoleRead,
    PERMISSION_KEYS.tenantRbacRoleCreate,
    PERMISSION_KEYS.tenantRbacRoleUpdate,
    PERMISSION_KEYS.tenantRbacRoleArchive,
    PERMISSION_KEYS.tenantRbacRolePermissionGrant,
    PERMISSION_KEYS.tenantRbacRolePermissionRevoke,
    PERMISSION_KEYS.tenantRbacAssignmentRead,
    PERMISSION_KEYS.tenantRbacAssignmentGrant,
    PERMISSION_KEYS.tenantRbacAssignmentRevoke,
    PERMISSION_KEYS.tenantPartnerRead,
    PERMISSION_KEYS.tenantPartnerVerificationRead,
    PERMISSION_KEYS.tenantPartnerPayoutAccountRead,
    PERMISSION_KEYS.tenantPartnerApplicationReview,
    PERMISSION_KEYS.tenantPartnerApplicationApprove,
    PERMISSION_KEYS.tenantPartnerApplicationReject,
    PERMISSION_KEYS.tenantPartnerLifecycleSuspend,
    PERMISSION_KEYS.tenantPartnerLifecycleReactivate,
    PERMISSION_KEYS.tenantPartnerLifecycleCancel,
  ]);
});

test("tenant administrator receives Partner review authority but no Partner lifecycle authority", () => {
  assert.equal(
    hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantMembershipOwnerPromote),
    false,
  );
  assert.equal(
    hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantMembershipOwnerDemote),
    false,
  );
  assert.deepEqual(getPermissions(SYSTEM_ROLES.tenantAdmin), [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantMembershipAdminInvite,
    PERMISSION_KEYS.tenantMembershipAdminSuspend,
    PERMISSION_KEYS.tenantMembershipAdminRevoke,
    PERMISSION_KEYS.tenantSecuritySessionRead,
    PERMISSION_KEYS.tenantSecuritySessionRevoke,
    PERMISSION_KEYS.tenantRbacPermissionRead,
    PERMISSION_KEYS.tenantRbacRoleRead,
    PERMISSION_KEYS.tenantRbacAssignmentRead,
    PERMISSION_KEYS.tenantPartnerRead,
    PERMISSION_KEYS.tenantPartnerVerificationRead,
    PERMISSION_KEYS.tenantPartnerPayoutAccountRead,
    PERMISSION_KEYS.tenantPartnerApplicationReview,
    PERMISSION_KEYS.tenantPartnerApplicationApprove,
    PERMISSION_KEYS.tenantPartnerApplicationReject,
  ]);
  assert.equal(
    hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantRbacRoleCreate),
    false,
  );
  assert.equal(
    hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantRbacAssignmentGrant),
    false,
  );
  assert.equal(
    hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantPartnerLifecycleSuspend),
    false,
  );
  assert.equal(
    hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantPartnerLifecycleReactivate),
    false,
  );
  assert.equal(
    hasPermission(SYSTEM_ROLES.tenantAdmin, PERMISSION_KEYS.tenantPartnerLifecycleCancel),
    false,
  );
});

test("partner owner receives all Sprint 3 Partner self-service permissions", () => {
  assert.deepEqual(getPermissions(SYSTEM_ROLES.partnerOwner), [
    PERMISSION_KEYS.partnerProfileRead,
    PERMISSION_KEYS.partnerProfileUpdate,
    PERMISSION_KEYS.partnerApplicationRead,
    PERMISSION_KEYS.partnerApplicationSubmit,
    PERMISSION_KEYS.partnerVerificationRead,
    PERMISSION_KEYS.partnerVerificationUpdate,
    PERMISSION_KEYS.partnerPayoutAccountRead,
    PERMISSION_KEYS.partnerPayoutAccountUpdate,
    PERMISSION_KEYS.partnerReviewFindingRead,
  ]);
});

test("partner admin may assist onboarding but cannot replace payout account", () => {
  assert.deepEqual(getPermissions(SYSTEM_ROLES.partnerAdmin), [
    PERMISSION_KEYS.partnerProfileRead,
    PERMISSION_KEYS.partnerProfileUpdate,
    PERMISSION_KEYS.partnerApplicationRead,
    PERMISSION_KEYS.partnerApplicationSubmit,
    PERMISSION_KEYS.partnerVerificationRead,
    PERMISSION_KEYS.partnerVerificationUpdate,
    PERMISSION_KEYS.partnerPayoutAccountRead,
    PERMISSION_KEYS.partnerReviewFindingRead,
  ]);
  assert.equal(
    hasPermission(SYSTEM_ROLES.partnerAdmin, PERMISSION_KEYS.partnerPayoutAccountUpdate),
    false,
  );
});

test("missing role has no permission", () => {
  assert.equal(hasPermission(undefined, PERMISSION_KEYS.tenantMembershipRead), false);
});

test("permission arrays are fresh values", () => {
  const first = getPermissions(SYSTEM_ROLES.tenantOwner);
  const second = getPermissions(SYSTEM_ROLES.tenantOwner);

  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});
