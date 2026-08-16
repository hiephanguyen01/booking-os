import { PERMISSION_KEYS, type PermissionKey } from "./permissions.js";

export interface PermissionCatalogEntry {
  readonly key: PermissionKey;
  readonly scopeLevel: "platform" | "tenant";
  readonly delegable: boolean;
  readonly description: string;
}

const ENTRIES: readonly PermissionCatalogEntry[] = [
  { key: PERMISSION_KEYS.platformSecurityAuditRead, scopeLevel: "platform", delegable: false, description: "Read platform security audit events." },
  { key: PERMISSION_KEYS.platformSecuritySessionRevoke, scopeLevel: "platform", delegable: false, description: "Revoke platform security sessions." },
  { key: PERMISSION_KEYS.platformTenantsProvision, scopeLevel: "platform", delegable: false, description: "Provision tenants." },
  { key: PERMISSION_KEYS.platformUsersProvision, scopeLevel: "platform", delegable: false, description: "Provision global users." },
  { key: PERMISSION_KEYS.tenantMembershipRead, scopeLevel: "tenant", delegable: true, description: "Read tenant memberships." },
  { key: PERMISSION_KEYS.tenantMembershipAdminInvite, scopeLevel: "tenant", delegable: true, description: "Invite tenant administrators." },
  { key: PERMISSION_KEYS.tenantMembershipAdminSuspend, scopeLevel: "tenant", delegable: true, description: "Suspend tenant administrators." },
  { key: PERMISSION_KEYS.tenantMembershipAdminRevoke, scopeLevel: "tenant", delegable: true, description: "Revoke tenant administrators." },
  { key: PERMISSION_KEYS.tenantMembershipOwnerPromote, scopeLevel: "tenant", delegable: false, description: "Promote a tenant owner." },
  { key: PERMISSION_KEYS.tenantMembershipOwnerDemote, scopeLevel: "tenant", delegable: false, description: "Demote a tenant owner." },
  { key: PERMISSION_KEYS.tenantSecuritySessionRead, scopeLevel: "tenant", delegable: true, description: "Read tenant security sessions." },
  { key: PERMISSION_KEYS.tenantSecuritySessionRevoke, scopeLevel: "tenant", delegable: true, description: "Revoke tenant security sessions." },
  { key: PERMISSION_KEYS.tenantRbacPermissionRead, scopeLevel: "tenant", delegable: true, description: "Read tenant RBAC permissions." },
  { key: PERMISSION_KEYS.tenantRbacRoleRead, scopeLevel: "tenant", delegable: true, description: "Read tenant custom roles." },
  { key: PERMISSION_KEYS.tenantRbacRoleCreate, scopeLevel: "tenant", delegable: false, description: "Create tenant custom roles." },
  { key: PERMISSION_KEYS.tenantRbacRoleUpdate, scopeLevel: "tenant", delegable: false, description: "Update tenant custom roles." },
  { key: PERMISSION_KEYS.tenantRbacRoleArchive, scopeLevel: "tenant", delegable: false, description: "Archive tenant custom roles." },
  { key: PERMISSION_KEYS.tenantRbacRolePermissionGrant, scopeLevel: "tenant", delegable: false, description: "Grant permissions to tenant custom roles." },
  { key: PERMISSION_KEYS.tenantRbacRolePermissionRevoke, scopeLevel: "tenant", delegable: false, description: "Revoke permissions from tenant custom roles." },
  { key: PERMISSION_KEYS.tenantRbacAssignmentRead, scopeLevel: "tenant", delegable: true, description: "Read tenant custom-role assignments." },
  { key: PERMISSION_KEYS.tenantRbacAssignmentGrant, scopeLevel: "tenant", delegable: false, description: "Grant tenant custom-role assignments." },
  { key: PERMISSION_KEYS.tenantRbacAssignmentRevoke, scopeLevel: "tenant", delegable: false, description: "Revoke tenant custom-role assignments." },
] as const;

const CATALOG = new Map<string, PermissionCatalogEntry>(ENTRIES.map((entry) => [entry.key, entry]));

export function getPermissionCatalogEntry(key: string): PermissionCatalogEntry | null {
  return CATALOG.get(key) ?? null;
}

export function isDelegableTenantPermission(key: PermissionKey): boolean {
  const entry = getPermissionCatalogEntry(key);
  return entry?.scopeLevel === "tenant" && entry.delegable;
}
