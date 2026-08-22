export type PartnerSystemRoleKey = "partner_owner" | "partner_admin";

export interface PartnerAuthorizationSnapshot {
  readonly partnerId: string;
  readonly partnerAuthorizationVersion: number;
  readonly partnerMembershipId: string;
  readonly partnerMembershipAuthorizationVersion: number;
  readonly roleKeys: readonly PartnerSystemRoleKey[];
  readonly permissions: readonly string[];
}

export interface PartnerAuthorizationQueryPort {
  loadForUser(partnerId: string, userId: string): Promise<PartnerAuthorizationSnapshot | null>;
}
