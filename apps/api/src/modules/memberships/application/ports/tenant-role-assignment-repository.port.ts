import type { SystemRole } from "@booking-os/auth";

export interface AssignTenantRoleInput {
  readonly userId: string;
  readonly roleKey: SystemRole;
  readonly now: Date;
}

export interface RevokeTenantRoleInput {
  readonly userId: string;
  readonly roleKey: SystemRole;
  readonly now: Date;
}

export interface TenantRoleAssignmentRepositoryPort {
  listActiveRoleKeys(userId: string): Promise<readonly SystemRole[]>;
  lockActiveOwnerUserIds(): Promise<readonly string[]>;
  assign(input: AssignTenantRoleInput): Promise<void>;
  revoke(input: RevokeTenantRoleInput): Promise<void>;
}
