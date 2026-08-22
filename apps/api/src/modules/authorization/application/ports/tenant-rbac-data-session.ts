import type { TenantCustomRoleAssignmentRepositoryPort } from "./tenant-custom-role-assignment-repository.port.js";
import type { TenantCustomRoleRepositoryPort } from "./tenant-custom-role-repository.port.js";
import type { TenantRbacPermissionRepositoryPort } from "./tenant-rbac-permission-repository.port.js";

export interface TenantRbacDataSession {
  readonly customRoles: TenantCustomRoleRepositoryPort;
  readonly customRoleAssignments: TenantCustomRoleAssignmentRepositoryPort;
  readonly rbacPermissions: TenantRbacPermissionRepositoryPort;
}
