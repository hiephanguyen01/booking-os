import { randomUUID } from "node:crypto";

import { normalizeEmail } from "@booking-os/auth";

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

const RESET_TTL_MS = 30 * 60 * 1000;
const RESET_EVENT_TYPE = "identity.password_reset.requested.v1" as const;

export interface RequestPasswordResetCommand {
  readonly email: string;
  readonly hostname: string;
  readonly scopeType: IdentityScopeType;
  readonly tenantId?: string;
  readonly requestId: string | null;
}

export class RequestPasswordResetUseCase {
  constructor(
    private readonly repository: IdentityRepositoryPort,
    private readonly outbox: IdentityOutboxPort,
    private readonly tokens: OneTimeTokenPort,
    private readonly envelope: SensitiveEnvelopePort,
    private readonly clock: ClockPort,
    private readonly createId: () => string = randomUUID,
  ) {}

  async execute(command: RequestPasswordResetCommand): Promise<void> {
    const normalizedEmail = normalizeEmail(command.email);
    const hostname = normalizeHostname(command.hostname);
    const tenantId = resolveTenantId(command.scopeType, command.tenantId);
    const user = await this.repository.findUserByNormalizedEmail(normalizedEmail);

    if (user?.status !== "active") {
      return;
    }

    const now = this.clock.now();
    const purpose = identityTokenPurpose("password_reset", command.scopeType, tenantId, hostname);
    const issued = this.tokens.issue(purpose);
    const tokenId = this.createId();
    const eventId = this.createId();
    const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
    const recipient = user.displayEmail;
    const template = "password_reset" as const;
    const associatedData = identityEmailAssociatedData({
      eventType: RESET_EVENT_TYPE,
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

    await this.outbox.issuePasswordReset({
      token: {
        id: tokenId,
        userId: user.id,
        scopeType: command.scopeType,
        tenantId,
        hostname,
        selector: issued.selector,
        tokenHash: issued.tokenHash,
        expiresAt,
        createdAt: now,
      },
      event: {
        id: eventId,
        type: RESET_EVENT_TYPE,
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
      audit: {
        eventType: "identity.password.reset_requested",
        actorUserId: null,
        subjectUserId: user.id,
        requestId: command.requestId,
        metadata: {
          action: "request_password_reset",
          result: "success",
          reason: "reset_issued",
          hostname,
          scopeType: command.scopeType,
          tenantId,
        },
        occurredAt: now,
      },
    });
  }
}
