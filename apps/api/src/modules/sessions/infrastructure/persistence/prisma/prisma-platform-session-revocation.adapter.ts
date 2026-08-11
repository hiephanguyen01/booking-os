import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { assertSafeSecurityAuditMetadata } from "../../../../../common/security/security-audit-metadata.js";
import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  PlatformSessionRevocationInput,
  PlatformSessionRevocationPort,
} from "../../../application/ports/platform-session-revocation.port.js";

@Injectable()
export class PrismaPlatformSessionRevocationAdapter implements PlatformSessionRevocationPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async revokeAllForUserAndAudit(input: PlatformSessionRevocationInput): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      const activeSessions = await transaction.authSession.findMany({
        where: { userId: input.targetUserId, revokedAt: null },
        select: { id: true },
      });
      const sessionIds = activeSessions.map((session) => session.id);
      let revokedSessionCount = 0;

      if (sessionIds.length > 0) {
        const result = await transaction.authSession.updateMany({
          where: { id: { in: sessionIds }, revokedAt: null },
          data: {
            state: "revoked",
            revokedAt: input.revokedAt,
            revocationReason: input.revocationReason,
            compromisedAt: null,
            version: { increment: 1 },
            updatedAt: input.revokedAt,
          },
        });
        revokedSessionCount = result.count;

        await transaction.authSessionToken.updateMany({
          where: { sessionId: { in: sessionIds }, revokedAt: null },
          data: { revokedAt: input.revokedAt },
        });
      }

      const metadata = {
        action: "revoke_all",
        result: "success",
        reason: "security_incident",
        hostname: input.hostname,
        scopeType: "platform",
        revokedSessionCount,
      } as const;
      assertSafeSecurityAuditMetadata(metadata);

      await transaction.securityAuditEvent.create({
        data: {
          eventType: "session.revoked",
          actorUserId: input.actorUserId,
          subjectUserId: input.targetUserId,
          requestId: input.requestId,
          metadata: metadata as Prisma.InputJsonObject,
          occurredAt: input.revokedAt,
        },
      });

      return revokedSessionCount;
    });
  }
}
