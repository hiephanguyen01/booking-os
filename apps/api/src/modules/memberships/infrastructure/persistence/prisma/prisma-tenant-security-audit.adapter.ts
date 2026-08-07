import type {
  TenantSecurityAuditInput,
  TenantSecurityAuditPort,
} from "../../../application/ports/tenant-security-audit.port.js";
import type { MembershipPrismaTransaction } from "./prisma-membership-transaction.js";

export class PrismaTenantSecurityAuditAdapter implements TenantSecurityAuditPort {
  constructor(
    private readonly transaction: MembershipPrismaTransaction,
    private readonly tenantId: string,
  ) {}

  async append(input: TenantSecurityAuditInput): Promise<void> {
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
