import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { assertSafeSecurityAuditMetadata } from "../../../../../common/security/security-audit-metadata.js";
import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  AuthorizationDeniedAuditRecord,
  AuthorizationSecurityAuditPort,
} from "../../../application/ports/authorization-security-audit.port.js";

@Injectable()
export class PrismaAuthorizationSecurityAuditAdapter implements AuthorizationSecurityAuditPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordDenied(record: AuthorizationDeniedAuditRecord): Promise<void> {
    const metadata = {
      permission: record.permission,
      scopeType: record.scopeType,
      tenantId: record.tenantId,
      reason: record.reason,
      sessionId: record.sessionId,
      result: "denied",
    } as const;
    assertSafeSecurityAuditMetadata(metadata);

    await this.prisma.securityAuditEvent.create({
      data: {
        eventType: record.eventType,
        actorUserId: record.actorUserId,
        subjectUserId: record.subjectUserId,
        requestId: record.requestId,
        metadata: metadata as Prisma.InputJsonObject,
        occurredAt: record.occurredAt,
      },
    });
  }
}
