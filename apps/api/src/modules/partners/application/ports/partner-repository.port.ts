import type {
  PartnerApplicationStatus,
  PartnerOperationalStatus,
  PartnerState,
} from "../../domain/partner.js";

export type PartnerMembershipStatus = "active" | "suspended" | "revoked";

export interface PartnerMembershipState {
  readonly id: string;
  readonly tenantId: string;
  readonly partnerId: string;
  readonly tenantMembershipId: string;
  readonly status: PartnerMembershipStatus;
  readonly authorizationVersion: number;
  readonly suspendedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UpdatePartnerStateInput {
  readonly partnerId: string;
  readonly expectedVersion: number;
  readonly changes: {
    readonly applicationStatus?: PartnerApplicationStatus;
    readonly operationalStatus?: PartnerOperationalStatus;
    readonly authorizationVersion?: number;
    readonly submittedAt?: Date | null;
    readonly approvedAt?: Date | null;
    readonly suspendedAt?: Date | null;
    readonly cancelledAt?: Date | null;
  };
}

export interface PartnerRepositoryPort {
  findById(partnerId: string): Promise<PartnerState | null>;
  findMembership(
    partnerId: string,
    tenantMembershipId: string,
  ): Promise<PartnerMembershipState | null>;
  lockPartner(partnerId: string): Promise<PartnerState | null>;
  updatePartnerState(input: UpdatePartnerStateInput): Promise<PartnerState>;
}
