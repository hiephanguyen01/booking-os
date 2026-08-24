import type { PartnerType } from "../../domain/partner.js";

export interface PartnerRegistrationChallengeRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly partnerType: PartnerType;
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly completedPartnerId: string | null;
  readonly createdAt: Date;
}

export interface UpsertPartnerRegistrationChallengeInput {
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly partnerType: PartnerType;
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly now: Date;
}

export interface PartnerRegistrationChallengeRepositoryPort {
  upsertForEmail(
    input: UpsertPartnerRegistrationChallengeInput,
  ): Promise<PartnerRegistrationChallengeRecord>;
  lockBySelector(selector: string): Promise<PartnerRegistrationChallengeRecord | null>;
  markCompleted(input: {
    readonly challengeId: string;
    readonly partnerId: string;
    readonly consumedAt: Date;
  }): Promise<void>;
}
