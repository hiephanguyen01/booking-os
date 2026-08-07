import type { SystemRole } from "@booking-os/auth";

export interface TenantRoleAssignment {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly roleKey: SystemRole;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

export function isActiveTenantRoleAssignment(
  assignment: TenantRoleAssignment,
): boolean {
  return assignment.revokedAt === null;
}
