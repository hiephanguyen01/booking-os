import type {
  PartnerApplicationStatus,
  PartnerOperationalStatus,
  PartnerType,
} from "../../domain/partner.js";

export interface PartnerRegistrationEstablishmentPort {
  createPartner(input: {
    readonly challengeId: string;
    readonly partnerType: PartnerType;
    readonly now: Date;
  }): Promise<{ readonly partnerId: string }>;
  createPartnerMembership(input: {
    readonly partnerId: string;
    readonly tenantMembershipId: string;
    readonly now: Date;
  }): Promise<{ readonly partnerMembershipId: string }>;
  assignPartnerOwner(input: {
    readonly partnerId: string;
    readonly partnerMembershipId: string;
    readonly now: Date;
  }): Promise<void>;
  appendRegistrationHistory(input: {
    readonly partnerId: string;
    readonly applicationStatus: PartnerApplicationStatus;
    readonly operationalStatus: PartnerOperationalStatus;
    readonly occurredAt: Date;
  }): Promise<void>;
  appendRegistrationOutbox(input: {
    readonly partnerId: string;
    readonly occurredAt: Date;
  }): Promise<void>;
}
