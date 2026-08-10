import type { AuthorizationContext } from "@booking-os/contracts";

import type { SessionRepositoryPort } from "../ports/session-repository.port.js";

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
    private readonly sessions: Pick<SessionRepositoryPort, "revokeAllForUser">,
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
    const revokedSessionCount = await this.sessions.revokeAllForUser({
      userId: input.targetUserId,
      revokedAt: this.clock.now(),
      reason: `platform_incident:${reason}`,
    });
    return { userId: input.targetUserId, revokedSessionCount };
  }
}
