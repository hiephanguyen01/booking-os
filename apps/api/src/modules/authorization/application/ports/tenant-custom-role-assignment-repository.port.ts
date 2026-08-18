import type { TenantCustomRoleAssignmentRecord } from "../../domain/tenant-rbac/tenant-custom-role.js";

export interface TenantCustomRoleAssignmentRepositoryPort {
  listActiveForMembership(
    membershipId: string,
  ): Promise<readonly TenantCustomRoleAssignmentRecord[]>;
  findActive(
    membershipId: string,
    roleId: string,
  ): Promise<TenantCustomRoleAssignmentRecord | null>;
  grant(
    membershipId: string,
    roleId: string,
    now: Date,
  ): Promise<TenantCustomRoleAssignmentRecord>;
  revoke(membershipId: string, roleId: string, now: Date): Promise<boolean>;
  revokeAllForRole(roleId: string, now: Date): Promise<readonly string[]>;
}
