import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { assertSafeSecurityAuditMetadata } from "../../../../../common/security/security-audit-metadata.js";
import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  SecurityAuditPort,
  SecurityAuditRecord,
} from "../../../application/ports/security-audit.port.js";

@Injectable()
export class PrismaSecurityAuditAdapter implements SecurityAuditPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(event: SecurityAuditRecord): Promise<void> {
    assertSafeSecurityAuditMetadata(event.metadata);

    await this.prisma.securityAuditEvent.create({
      data: {
        eventType: event.eventType,
        actorUserId: event.actorUserId,
        subjectUserId: event.subjectUserId,
        requestId: event.requestId,
        metadata: { ...event.metadata } as Prisma.InputJsonObject,
        occurredAt: event.occurredAt,
      },
    });
  }
}
