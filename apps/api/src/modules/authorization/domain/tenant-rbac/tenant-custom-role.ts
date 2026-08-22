import type { PermissionKey } from "@booking-os/auth";

export interface TenantCustomRoleRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly description: string | null;
  readonly version: number;
  readonly archivedAt: Date | null;
  readonly permissionKeys: readonly PermissionKey[];
}

export interface CreateTenantCustomRoleRecordInput {
  readonly name: string;
  readonly normalizedName: string;
  readonly description: string | null;
  readonly now: Date;
}

export interface UpdateTenantCustomRoleMetadataRecordInput {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly description: string | null;
  readonly expectedVersion: number;
  readonly now: Date;
}

export interface TenantCustomRoleAssignmentRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly roleId: string;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}
