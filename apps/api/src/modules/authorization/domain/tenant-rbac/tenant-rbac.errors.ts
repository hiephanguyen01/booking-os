export const TENANT_RBAC_ERROR_CODES = {
  customRoleNameInvalid: "TENANT_CUSTOM_ROLE_NAME_INVALID",
  customRoleNotFound: "TENANT_CUSTOM_ROLE_NOT_FOUND",
  customRoleNameConflict: "TENANT_CUSTOM_ROLE_NAME_CONFLICT",
  customRoleArchived: "TENANT_CUSTOM_ROLE_ARCHIVED",
  customRoleVersionConflict: "TENANT_CUSTOM_ROLE_VERSION_CONFLICT",
  permissionUnknown: "TENANT_RBAC_PERMISSION_UNKNOWN",
  permissionScopeInvalid: "TENANT_RBAC_PERMISSION_SCOPE_INVALID",
  permissionNotDelegable: "TENANT_RBAC_PERMISSION_NOT_DELEGABLE",
  permissionGrantNotAllowed: "TENANT_RBAC_PERMISSION_GRANT_NOT_ALLOWED",
  assignmentNotAllowed: "TENANT_RBAC_ASSIGNMENT_NOT_ALLOWED",
  assignmentNotFound: "TENANT_RBAC_ASSIGNMENT_NOT_FOUND",
} as const;

export type TenantRbacErrorCode =
  (typeof TENANT_RBAC_ERROR_CODES)[keyof typeof TENANT_RBAC_ERROR_CODES];

export class TenantRbacError extends Error {
  readonly code: TenantRbacErrorCode;

  constructor(code: TenantRbacErrorCode) {
    super(code);
    this.code = code;
    this.name = new.target.name;
  }
}

export class TenantCustomRoleNameInvalidError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.customRoleNameInvalid);
  }
}

export class TenantCustomRoleNotFoundError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.customRoleNotFound);
  }
}

export class TenantCustomRoleNameConflictError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.customRoleNameConflict);
  }
}

export class TenantCustomRoleArchivedError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.customRoleArchived);
  }
}

export class TenantCustomRoleVersionConflictError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.customRoleVersionConflict);
  }
}

export class TenantRbacPermissionUnknownError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.permissionUnknown);
  }
}

export class TenantRbacPermissionScopeInvalidError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.permissionScopeInvalid);
  }
}

export class TenantRbacPermissionNotDelegableError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.permissionNotDelegable);
  }
}

export class TenantRbacPermissionGrantNotAllowedError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.permissionGrantNotAllowed);
  }
}

export class TenantRbacAssignmentNotAllowedError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.assignmentNotAllowed);
  }
}

export class TenantRbacAssignmentNotFoundError extends TenantRbacError {
  constructor() {
    super(TENANT_RBAC_ERROR_CODES.assignmentNotFound);
  }
}
