export const TENANT_MEMBERSHIP_STATUSES = ["invited", "active", "suspended", "revoked"] as const;

export type TenantMembershipStatus = (typeof TENANT_MEMBERSHIP_STATUSES)[number];

export interface TenantMembership {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly status: TenantMembershipStatus;
  readonly authorizationVersion: number;
  readonly acceptedAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function isActiveTenantMembership(
  membership: TenantMembership | null | undefined,
): membership is TenantMembership & { readonly status: "active" } {
  return membership?.status === "active";
}
