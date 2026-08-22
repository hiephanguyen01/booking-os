import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { SensitiveEnvelopePort } from "../../../../identity/application/ports/sensitive-envelope.port.js";
import type {
  AppendPartnerRegistrationVerificationRequestedInput,
  PartnerRegistrationNotifierPort,
} from "../../../application/ports/partner-registration-notifier.port.js";

const EVENT_TYPE = "partner.registration.verification_requested" as const;
const TEMPLATE = "partner_registration_verification" as const;

function notificationAssociatedData(input: {
  readonly eventId: string;
  readonly tenantId: string;
  readonly challengeId: string;
  readonly hostname: string;
  readonly recipient: string;
}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      eventType: EVENT_TYPE,
      eventId: input.eventId,
      tenantId: input.tenantId,
      challengeId: input.challengeId,
      hostname: input.hostname,
      recipient: input.recipient,
      template: TEMPLATE,
    }),
  );
}

export class PrismaPartnerRegistrationNotifierAdapter implements PartnerRegistrationNotifierPort {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
    private readonly envelope: SensitiveEnvelopePort | undefined,
    private readonly createId: () => string = randomUUID,
  ) {}

  async appendVerificationRequested(
    input: AppendPartnerRegistrationVerificationRequestedInput,
  ): Promise<void> {
    if (!this.envelope) {
      throw new Error("Partner registration notification envelope is unavailable.");
    }

    const eventId = this.createId();
    const associatedData = notificationAssociatedData({
      eventId,
      tenantId: this.tenantId,
      challengeId: input.challengeId,
      hostname: input.hostname,
      recipient: input.displayEmail,
    });
    const sealed = this.envelope.seal(
      new TextEncoder().encode(JSON.stringify({ token: input.serializedToken })),
      associatedData,
    );
    const payload: Prisma.InputJsonObject = {
      version: 1,
      recipient: input.displayEmail,
      normalizedEmail: input.normalizedEmail,
      template: TEMPLATE,
      hostname: input.hostname,
      envelope: {
        version: sealed.version,
        keyId: sealed.keyId,
        iv: sealed.iv,
        ciphertext: sealed.ciphertext,
        tag: sealed.tag,
      },
    };

    await this.transaction.outboxEvent.create({
      data: {
        id: eventId,
        tenantId: this.tenantId,
        type: EVENT_TYPE,
        aggregateType: "partner_registration_challenge",
        aggregateId: input.challengeId,
        payload,
        occurredAt: input.occurredAt,
      },
    });
  }
}
