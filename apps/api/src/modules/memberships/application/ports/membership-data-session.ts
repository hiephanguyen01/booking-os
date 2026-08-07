import type { AuthorizationQueryPort } from "./authorization-query.port.js";
import type { InvitationRepositoryPort } from "./invitation-repository.port.js";
import type { MembershipRepositoryPort } from "./membership-repository.port.js";
import type { TenantProvisioningRepositoryPort } from "./tenant-provisioning.port.js";
import type { TenantRoleAssignmentRepositoryPort } from "./tenant-role-assignment-repository.port.js";
import type { TenantSecurityAuditPort } from "./tenant-security-audit.port.js";

export interface MembershipDataSession {
  readonly authorization: AuthorizationQueryPort;
  readonly memberships: MembershipRepositoryPort;
  readonly invitations: InvitationRepositoryPort;
  readonly roles: TenantRoleAssignmentRepositoryPort;
  readonly tenants: TenantProvisioningRepositoryPort;
  readonly audit: TenantSecurityAuditPort;
}
