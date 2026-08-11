import type { AuthorizationContext } from "@booking-os/contracts";

import type { AuthMetricsPort } from "../../../../observability/auth-metrics.port.js";
import type { PlatformSessionRevocationPort } from "../ports/platform-session-revocation.port.js";

const REQUIRED_PERMISSION = "platform.security.session.revoke" as const;

export class AdminSessionRevocationForbiddenError extends Error {
  constructor() {
    super("Platform session revocation permission is required.");
    this.name = "AdminSessionRevocationForbiddenError";
  }
}

export interface AdminRevokeUserSessionsInput {
  readonly authorization: AuthorizationContext;
  readonly targetUserId: string;
  readonly reason: string;
  readonly requestId: string;
  readonly hostname: string;
}

export interface AdminRevokeUserSessionsResult {
  readonly userId: string;
  readonly revokedSessionCount: number;
}

export interface AdminRevokeUserSessionsClock {
  now(): Date;
}

export class AdminRevokeUserSessionsUseCase {
  constructor(
    private readonly mutations: PlatformSessionRevocationPort,
    private readonly metrics: AuthMetricsPort,
    private readonly clock: AdminRevokeUserSessionsClock = { now: () => new Date() },
  ) {}

  async execute(input: AdminRevokeUserSessionsInput): Promise<AdminRevokeUserSessionsResult> {
    if (
      input.authorization.scope.type !== "platform" ||
      !input.authorization.permissionKeys.includes(REQUIRED_PERMISSION)
    ) {
      throw new AdminSessionRevocationForbiddenError();
    }

    const reason = input.reason.trim();
    const revokedSessionCount = await this.mutations.revokeAllForUserAndAudit({
      actorUserId: input.authorization.userId,
      targetUserId: input.targetUserId,
      revokedAt: this.clock.now(),
      revocationReason: `platform_incident:${reason}`,
      requestId: input.requestId,
      hostname: input.hostname,
    });

    this.metrics.record({
      eventType: "session",
      purpose: "revoke",
      outcome: "success",
      scope: "platform",
      reasonFamily: "security_incident",
      delayBucket: "none",
    });

    return { userId: input.targetUserId, revokedSessionCount };
  }
}
