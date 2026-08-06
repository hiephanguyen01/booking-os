import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  SessionSecurityAuditPort,
  SessionSecurityAuditRecord,
} from "../../../application/ports/security-audit.port.js";

@Injectable()
export class PrismaSessionSecurityAuditAdapter implements SessionSecurityAuditPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(record: SessionSecurityAuditRecord): Promise<void> {
    await this.prisma.securityAuditEvent.create({
      data: {
        eventType: record.eventType,
        actorUserId: record.actorUserId,
        subjectUserId: record.subjectUserId,
        requestId: record.requestId,
        metadata: {
          ...record.metadata,
          sessionId: record.sessionId,
        } as Prisma.InputJsonObject,
        occurredAt: record.occurredAt,
      },
    });
  }
}
