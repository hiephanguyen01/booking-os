import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext, TenantExecutionContext } from "@booking-os/contracts";

import type {
  TenantDataSession,
  TenantTransactionPort,
} from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import type { TenantCustomRoleRecord } from "../../../domain/tenant-rbac/tenant-custom-role.js";

export const TENANT_ID = "550e8400-e29b-41d4-a716-446655440101";
export const USER_ID = "550e8400-e29b-41d4-a716-446655440102";
export const SESSION_ID = "550e8400-e29b-41d4-a716-446655440103";
export const MEMBERSHIP_ID = "550e8400-e29b-41d4-a716-446655440104";
export const ROLE_ID = "550e8400-e29b-41d4-a716-446655440105";
export const NOW = new Date("2026-08-18T04:00:00.000Z");

export function ownerAuthorization(): AuthorizationContext {
  return Object.freeze({
    userId: USER_ID,
    sessionId: SESSION_ID,
    scope: { type: "tenant" as const, tenantId: TENANT_ID, tenantSlug: "tenant-a" },
    membershipId: MEMBERSHIP_ID,
    membershipStatus: "active",
    roleKeys: ["tenant_owner"],
    permissionKeys: [
      PERMISSION_KEYS.tenantMembershipRead,
      PERMISSION_KEYS.tenantRbacPermissionRead,
      PERMISSION_KEYS.tenantRbacRoleRead,
      PERMISSION_KEYS.tenantRbacRoleCreate,
      PERMISSION_KEYS.tenantRbacRoleUpdate,
    ],
    userAuthorizationVersion: 1,
    membershipAuthorizationVersion: 1,
  });
}

export function adminAuthorization(): AuthorizationContext {
  return Object.freeze({
    userId: USER_ID,
    sessionId: SESSION_ID,
    scope: { type: "tenant" as const, tenantId: TENANT_ID, tenantSlug: "tenant-a" },
    membershipId: MEMBERSHIP_ID,
    membershipStatus: "active",
    roleKeys: ["tenant_admin"],
    permissionKeys: [PERMISSION_KEYS.tenantRbacPermissionRead, PERMISSION_KEYS.tenantRbacRoleRead],
    userAuthorizationVersion: 1,
    membershipAuthorizationVersion: 1,
  });
}

export function customRole(
  overrides: Partial<TenantCustomRoleRecord> = {},
): TenantCustomRoleRecord {
  return Object.freeze({
    id: ROLE_ID,
    tenantId: TENANT_ID,
    name: "Dispatcher",
    normalizedName: "dispatcher",
    description: "Dispatch desk",
    version: 3,
    archivedAt: null,
    permissionKeys: [PERMISSION_KEYS.tenantMembershipRead],
    ...overrides,
  });
}

export class RecordingTenantTransactions implements TenantTransactionPort {
  readonly contexts: TenantExecutionContext[] = [];
  readonly events: string[] = [];

  constructor(private readonly session: Partial<TenantDataSession>) {}

  async run<T>(
    context: TenantExecutionContext,
    work: (session: TenantDataSession) => Promise<T>,
  ): Promise<T> {
    this.contexts.push(context);
    this.events.push("transaction.begin");
    const result = await work(this.session as TenantDataSession);
    this.events.push("transaction.commit");
    return result;
  }
}
