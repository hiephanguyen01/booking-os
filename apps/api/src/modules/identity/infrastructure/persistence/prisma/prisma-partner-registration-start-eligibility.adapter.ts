import type { Prisma } from "@prisma/client";

import type {
  PartnerRegistrationStartEligibility,
  PartnerRegistrationStartEligibilityPort,
} from "../../../application/partner-registration-identity.contract.js";

export class PrismaPartnerRegistrationStartEligibilityAdapter
  implements PartnerRegistrationStartEligibilityPort
{
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
  ) {}

  async classifyStart(input: {
    readonly normalizedEmail: string;
  }): Promise<PartnerRegistrationStartEligibility> {
    const user = await this.transaction.user.findUnique({
      where: { normalizedEmail: input.normalizedEmail },
      select: { id: true, status: true },
    });

    if (!user) {
      return Object.freeze({ eligible: true as const, tenantMembershipId: null });
    }

    if (user.status === "suspended" || user.status === "disabled") {
      return Object.freeze({ eligible: false as const, reason: "identity_unavailable" as const });
    }

    const membership = await this.transaction.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: this.tenantId,
          userId: user.id,
        },
      },
      select: { id: true, status: true },
    });

    if (!membership) {
      return Object.freeze({ eligible: true as const, tenantMembershipId: null });
    }

    if (membership.status === "suspended" || membership.status === "revoked") {
      return Object.freeze({
        eligible: false as const,
        reason: "tenant_membership_unavailable" as const,
      });
    }

    return Object.freeze({
      eligible: true as const,
      tenantMembershipId: membership.id,
    });
  }
}
