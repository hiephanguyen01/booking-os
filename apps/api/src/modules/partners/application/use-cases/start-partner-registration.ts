import { normalizeEmail } from "@booking-os/auth";
import type { TenantExecutionContext } from "@booking-os/contracts";

import type { OneTimeTokenPort } from "../../../identity/application/ports/one-time-token.port.js";
import type { PartnerType } from "../../domain/partner.js";
import type { PartnerTransactionPort } from "../ports/partner-transaction.port.js";

const PARTNER_REGISTRATION_TOKEN_PURPOSE = "partner_registration";
const PARTNER_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;

function canonicalHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export interface StartPartnerRegistrationInput {
  readonly context: TenantExecutionContext;
  readonly hostname: string;
  readonly email: string;
  readonly partnerType: PartnerType;
  readonly now: Date;
}

export class StartPartnerRegistrationUseCase {
  constructor(
    private readonly transactions: PartnerTransactionPort,
    private readonly oneTimeTokens: OneTimeTokenPort,
  ) {}

  async execute(input: StartPartnerRegistrationInput): Promise<{ readonly accepted: true }> {
    const displayEmail = input.email.trim().normalize("NFC");
    const normalizedEmail = normalizeEmail(displayEmail);
    const hostname = canonicalHostname(input.hostname);
    const issued = this.oneTimeTokens.issue(PARTNER_REGISTRATION_TOKEN_PURPOSE);
    const expiresAt = new Date(input.now.getTime() + PARTNER_REGISTRATION_TTL_MS);

    await this.transactions.run(input.context, async (session) => {
      const challenge = await session.partnerRegistrationChallenges.upsertForEmail({
        normalizedEmail,
        displayEmail,
        partnerType: input.partnerType,
        hostname,
        selector: issued.selector,
        tokenHash: issued.tokenHash,
        expiresAt,
        now: input.now,
      });

      await session.partnerRegistrationNotifier.appendVerificationRequested({
        challengeId: challenge.id,
        normalizedEmail,
        displayEmail,
        serializedToken: issued.serialized,
        hostname,
        occurredAt: input.now,
      });
    });

    return Object.freeze({ accepted: true as const });
  }
}
