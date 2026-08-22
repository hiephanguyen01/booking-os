import type {
  CreateTenantCustomRoleRecordInput,
  TenantCustomRoleRecord,
  UpdateTenantCustomRoleMetadataRecordInput,
} from "../../domain/tenant-rbac/tenant-custom-role.js";

export interface TenantCustomRoleRepositoryPort {
  list(): Promise<readonly TenantCustomRoleRecord[]>;
  findById(id: string): Promise<TenantCustomRoleRecord | null>;
  lockById(id: string): Promise<TenantCustomRoleRecord | null>;
  create(input: CreateTenantCustomRoleRecordInput): Promise<TenantCustomRoleRecord>;
  updateMetadata(input: UpdateTenantCustomRoleMetadataRecordInput): Promise<TenantCustomRoleRecord>;
  replacePermissions(roleId: string, permissionIds: readonly string[]): Promise<void>;
  archive(roleId: string, now: Date): Promise<TenantCustomRoleRecord>;
  listActiveHolderMembershipIds(roleId: string): Promise<readonly string[]>;
}
