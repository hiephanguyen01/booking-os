import type { Prisma } from "@prisma/client";

import { assertSafeSecurityAuditMetadata } from "../../../../../common/security/security-audit-metadata.js";
import type {
  PartnerSecurityAuditInput,
  PartnerSecurityAuditPort,
} from "../../../application/ports/partner-security-audit.port.js";

export class PrismaPartnerSecurityAuditAdapter implements PartnerSecurityAuditPort {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
  ) {}

  async append(input: PartnerSecurityAuditInput): Promise<void> {
    assertSafeSecurityAuditMetadata(input.metadata);

    await this.transaction.$executeRawUnsafe(
      `INSERT INTO "tenant_security_audit_events" (
         "id", "tenant_id", "event_type", "actor_user_id", "subject_user_id",
         "request_id", "metadata", "occurred_at"
       )
       VALUES (
         gen_random_uuid(), $1::uuid, $2, $3::uuid, $4::uuid,
         $5, $6::jsonb, $7::timestamptz
       )`,
      this.tenantId,
      input.eventType,
      input.actorUserId,
      input.subjectUserId,
      input.requestId,
      JSON.stringify(input.metadata),
      input.occurredAt,
    );
  }
}
