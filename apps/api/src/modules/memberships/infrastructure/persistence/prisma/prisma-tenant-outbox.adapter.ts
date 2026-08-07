import type {
  AppendTenantOutboxEventInput,
  TenantOutboxPort,
} from "../../../application/ports/tenant-outbox.port.js";
import type { MembershipPrismaTransaction } from "./prisma-membership-transaction.js";

export class PrismaTenantOutboxAdapter implements TenantOutboxPort {
  constructor(
    private readonly transaction: MembershipPrismaTransaction,
    private readonly tenantId: string,
  ) {}

  async append(input: AppendTenantOutboxEventInput): Promise<void> {
    await this.transaction.$executeRawUnsafe(
      `INSERT INTO "outbox_events" (
         "id", "tenant_id", "type", "aggregate_type", "aggregate_id",
         "payload", "occurred_at", "available_at"
       )
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb, $7::timestamptz, $8::timestamptz)`,
      input.id,
      this.tenantId,
      input.type,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload),
      input.occurredAt,
      input.availableAt ?? input.occurredAt,
    );
  }
}
