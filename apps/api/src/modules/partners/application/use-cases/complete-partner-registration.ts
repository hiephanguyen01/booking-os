import type { TenantExecutionContext } from "@booking-os/contracts";

import type { OneTimeTokenPort } from "../../../identity/application/ports/one-time-token.port.js";
import type { PartnerTransactionPort } from "../ports/partner-transaction.port.js";

const PARTNER_REGISTRATION_TOKEN_PURPOSE = "partner_registration";

function canonicalHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export class PartnerRegistrationChallengeInvalidError extends Error {
  readonly code = "PARTNER_REGISTRATION_CHALLENGE_INVALID";

  constructor() {
    super("Partner registration challenge is invalid.");
    this.name = new.target.name;
  }
}

export interface CompletePartnerRegistrationInput {
  readonly context: TenantExecutionContext;
  readonly hostname: string;
  readonly serializedToken: string;
  readonly password?: string;
  readonly now: Date;
}

export class CompletePartnerRegistrationUseCase {
  constructor(
    private readonly transactions: PartnerTransactionPort,
    private readonly oneTimeTokens: OneTimeTokenPort,
  ) {}

  async execute(input: CompletePartnerRegistrationInput): Promise<{ readonly partnerId: string }> {
    const derived = this.oneTimeTokens.derive(
      input.serializedToken,
      PARTNER_REGISTRATION_TOKEN_PURPOSE,
    );
    if (!derived) throw new PartnerRegistrationChallengeInvalidError();

    const hostname = canonicalHostname(input.hostname);

    return this.transactions.run(input.context, async (session) => {
      const challenge = await session.partnerRegistrationChallenges.lockBySelector(
        derived.selector,
      );
      if (
        !challenge ||
        challenge.hostname !== hostname ||
        challenge.revokedAt !== null ||
        challenge.expiresAt.getTime() <= input.now.getTime()
      ) {
        throw new PartnerRegistrationChallengeInvalidError();
      }

      const verified = this.oneTimeTokens.verify(
        input.serializedToken,
        PARTNER_REGISTRATION_TOKEN_PURPOSE,
        challenge.tokenHash,
      );
      if (!verified || verified.selector !== derived.selector) {
        throw new PartnerRegistrationChallengeInvalidError();
      }

      if (challenge.completedPartnerId !== null) {
        return Object.freeze({ partnerId: challenge.completedPartnerId });
      }
      if (challenge.consumedAt !== null) {
        throw new PartnerRegistrationChallengeInvalidError();
      }

      const identity = await session.partnerRegistrationIdentity.resolveOrCreateVerifiedIdentity({
        normalizedEmail: challenge.normalizedEmail,
        displayEmail: challenge.displayEmail,
        ...(input.password === undefined ? {} : { password: input.password }),
      });
      const tenantMembership =
        await session.partnerRegistrationIdentity.ensureActiveTenantMembership({
          tenantId: input.context.tenantId,
          userId: identity.userId,
        });
      const partner = await session.partnerRegistrationEstablishment.createPartner({
        challengeId: challenge.id,
        partnerType: challenge.partnerType,
        now: input.now,
      });
      const partnerMembership =
        await session.partnerRegistrationEstablishment.createPartnerMembership({
          partnerId: partner.partnerId,
          tenantMembershipId: tenantMembership.tenantMembershipId,
          now: input.now,
        });
      await session.partnerRegistrationEstablishment.assignPartnerOwner({
        partnerId: partner.partnerId,
        partnerMembershipId: partnerMembership.partnerMembershipId,
        now: input.now,
      });
      await session.partnerRegistrationChallenges.markCompleted({
        challengeId: challenge.id,
        partnerId: partner.partnerId,
        consumedAt: input.now,
      });
      await session.partnerRegistrationEstablishment.appendRegistrationHistory({
        partnerId: partner.partnerId,
        applicationStatus: "draft",
        operationalStatus: "inactive",
        occurredAt: input.now,
      });
      await session.partnerSecurityAudit.append({
        eventType: "partner.registration.completed",
        actorUserId: identity.userId,
        subjectUserId: identity.userId,
        requestId: input.context.requestId,
        metadata: { result: "completed", reason: "verified" },
        occurredAt: input.now,
      });
      await session.partnerRegistrationEstablishment.appendRegistrationOutbox({
        partnerId: partner.partnerId,
        occurredAt: input.now,
      });

      return Object.freeze({ partnerId: partner.partnerId });
    });
  }
}
