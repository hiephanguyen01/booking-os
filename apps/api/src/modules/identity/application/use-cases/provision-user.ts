import { randomUUID } from "node:crypto";

import { normalizeEmail } from "@booking-os/auth";

import { IdentityEmailConflictError } from "../../domain/identity-errors.js";
import type { IdentityScopeType } from "../../domain/user.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { IdentityOutboxPort } from "../ports/identity-outbox.port.js";
import type { IdentityRepositoryPort } from "../ports/identity-repository.port.js";
import type { OneTimeTokenPort } from "../ports/one-time-token.port.js";
import type { SensitiveEnvelopePort } from "../ports/sensitive-envelope.port.js";
import {
  identityEmailAssociatedData,
  identityTokenPurpose,
  normalizeHostname,
  resolveTenantId,
} from "./identity-use-case-utils.js";

const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVATION_EVENT_TYPE = "identity.activation.requested.v1" as const;

export interface ProvisionUserCommand {
  readonly email: string;
  readonly hostname: string;
  readonly scopeType: IdentityScopeType;
  readonly tenantId?: string;
  readonly invitationId?: string;
  readonly requestedByUserId: string;
  readonly requestId: string | null;
}

export interface ProvisionUserResult {
  readonly userId: string;
}

export class ProvisionUserUseCase {
  constructor(
    private readonly repository: IdentityRepositoryPort,
    private readonly outbox: IdentityOutboxPort,
    private readonly tokens: OneTimeTokenPort,
    private readonly envelope: SensitiveEnvelopePort,
    private readonly clock: ClockPort,
    private readonly createId: () => string = randomUUID,
  ) {}

  async execute(command: ProvisionUserCommand): Promise<ProvisionUserResult> {
    const normalizedEmail = normalizeEmail(command.email);
    const displayEmail = command.email.trim().normalize("NFC");
    const hostname = normalizeHostname(command.hostname);
    const tenantId = resolveTenantId(command.scopeType, command.tenantId);
    const now = this.clock.now();
    let user = await this.repository.findUserByNormalizedEmail(normalizedEmail);

    if (!user) {
      try {
        user = await this.repository.createPendingUser({
          normalizedEmail,
          displayEmail,
          now,
          requestedByUserId: command.requestedByUserId,
          requestId: command.requestId,
          hostname,
          scopeType: command.scopeType,
          tenantId,
        });
      } catch (error: unknown) {
        if (!(error instanceof IdentityEmailConflictError)) {
          throw error;
        }
        user = await this.repository.findUserByNormalizedEmail(normalizedEmail);
        if (!user) {
          throw error;
        }
      }
    }

    if (user.status !== "pending_activation") {
      return Object.freeze({ userId: user.id });
    }

    const purpose = identityTokenPurpose("activation", command.scopeType, tenantId, hostname);
    const issued = this.tokens.issue(purpose);
    const tokenId = this.createId();
    const eventId = this.createId();
    const expiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS);
    const recipient = user.displayEmail;
    const template = "account_activation" as const;
    const associatedData = identityEmailAssociatedData({
      eventType: ACTIVATION_EVENT_TYPE,
      eventId,
      userId: user.id,
      hostname,
      recipient,
      template,
    });
    const sealed = this.envelope.seal(
      new TextEncoder().encode(JSON.stringify({ token: issued.serialized })),
      associatedData,
    );

    await this.outbox.issueActivation({
      token: {
        id: tokenId,
        userId: user.id,
        scopeType: command.scopeType,
        tenantId,
        invitationId: command.invitationId ?? null,
        hostname,
        selector: issued.selector,
        tokenHash: issued.tokenHash,
        expiresAt,
        createdAt: now,
      },
      event: {
        id: eventId,
        type: ACTIVATION_EVENT_TYPE,
        tenantId,
        aggregateType: "user",
        aggregateId: user.id,
        occurredAt: now,
        payload: {
          version: 1,
          recipient,
          template,
          hostname,
          envelope: sealed,
        },
      },
    });

    return Object.freeze({ userId: user.id });
  }
}
