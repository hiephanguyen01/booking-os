export const MEMBERSHIP_ERROR_CODES = {
  membershipRequired: "MEMBERSHIP_REQUIRED",
  membershipInactive: "MEMBERSHIP_INACTIVE",
  invitationInvalidOrExpired: "INVITATION_INVALID_OR_EXPIRED",
  roleGrantNotAllowed: "ROLE_GRANT_NOT_ALLOWED",
  lastTenantOwner: "LAST_TENANT_OWNER",
  tenantNotAvailable: "TENANT_NOT_AVAILABLE",
  tenantProvisioningConflict: "TENANT_PROVISIONING_CONFLICT",
  tenantProvisioningIdempotencyConflict: "TENANT_PROVISIONING_IDEMPOTENCY_CONFLICT",
  tenantProvisioningInProgress: "TENANT_PROVISIONING_IN_PROGRESS",
} as const;

export type MembershipErrorCode =
  (typeof MEMBERSHIP_ERROR_CODES)[keyof typeof MEMBERSHIP_ERROR_CODES];

export class MembershipError extends Error {
  readonly code: MembershipErrorCode;

  constructor(code: MembershipErrorCode) {
    super(code);
    this.code = code;
    this.name = new.target.name;
  }
}

export class MembershipRequiredError extends MembershipError {
  constructor() {
    super(MEMBERSHIP_ERROR_CODES.membershipRequired);
  }
}

export class MembershipInactiveError extends MembershipError {
  constructor() {
    super(MEMBERSHIP_ERROR_CODES.membershipInactive);
  }
}

export class InvitationInvalidOrExpiredError extends MembershipError {
  constructor() {
    super(MEMBERSHIP_ERROR_CODES.invitationInvalidOrExpired);
  }
}

export class RoleGrantNotAllowedError extends MembershipError {
  constructor() {
    super(MEMBERSHIP_ERROR_CODES.roleGrantNotAllowed);
  }
}

export class LastTenantOwnerError extends MembershipError {
  constructor() {
    super(MEMBERSHIP_ERROR_CODES.lastTenantOwner);
  }
}

export class TenantNotAvailableError extends MembershipError {
  constructor() {
    super(MEMBERSHIP_ERROR_CODES.tenantNotAvailable);
  }
}

export class TenantProvisioningConflictError extends MembershipError {
  constructor() {
    super(MEMBERSHIP_ERROR_CODES.tenantProvisioningConflict);
  }
}

export class TenantProvisioningIdempotencyConflictError extends MembershipError {
  constructor() {
    super(MEMBERSHIP_ERROR_CODES.tenantProvisioningIdempotencyConflict);
  }
}

export class TenantProvisioningInProgressError extends MembershipError {
  constructor() {
    super(MEMBERSHIP_ERROR_CODES.tenantProvisioningInProgress);
  }
}
