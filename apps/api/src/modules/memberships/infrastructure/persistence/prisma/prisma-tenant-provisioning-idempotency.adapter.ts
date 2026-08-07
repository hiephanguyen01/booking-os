import type {
  ClaimTenantProvisioningInput,
  ClaimTenantProvisioningResult,
  CompleteTenantProvisioningInput,
  TenantProvisioningIdempotencyPort,
} from "../../../application/ports/tenant-provisioning-idempotency.port.js";
import {
  TenantProvisioningIdempotencyConflictError,
  TenantProvisioningInProgressError,
} from "../../../domain/membership-errors.js";
import type { MembershipPrismaTransaction } from "./prisma-membership-transaction.js";

type InsertedRow = Readonly<{ inserted: boolean }>;

type ProvisioningRequestRow = Readonly<{
  requestHash: string;
  status: "in_progress" | "completed";
  tenantId: string | null;
  tenantSlug: string | null;
  ownerMembershipId: string | null;
  ownerInvitationId: string | null;
  completedAt: Date | null;
}>;

function requireCompletedResult(row: ProvisioningRequestRow): ClaimTenantProvisioningResult {
  if (
    row.status !== "completed" ||
    row.tenantId === null ||
    row.tenantSlug === null ||
    row.ownerMembershipId === null ||
    row.ownerInvitationId === null ||
    row.completedAt === null
  ) {
    throw new TenantProvisioningInProgressError();
  }

  return {
    status: "completed",
    result: {
      tenantId: row.tenantId,
      slug: row.tenantSlug,
      status: "provisioning",
      ownerMembershipId: row.ownerMembershipId,
      ownerInvitationId: row.ownerInvitationId,
      replayed: true,
    },
  };
}

export class PrismaTenantProvisioningIdempotencyAdapter
  implements TenantProvisioningIdempotencyPort
{
  constructor(private readonly transaction: MembershipPrismaTransaction) {}

  async claim(input: ClaimTenantProvisioningInput): Promise<ClaimTenantProvisioningResult> {
    const insertedRows = await this.transaction.$queryRawUnsafe<InsertedRow[]>(
      `INSERT INTO "tenant_provisioning_requests" (
         "idempotency_key",
         "request_hash",
         "actor_user_id",
         "status",
         "created_at",
         "updated_at"
       )
       VALUES ($1, $2, $3::uuid, 'in_progress', $4, $4)
       ON CONFLICT ("idempotency_key") DO NOTHING
       RETURNING TRUE AS "inserted"`,
      input.key,
      input.requestHash,
      input.actorUserId,
      input.now,
    );

    if (insertedRows.length > 0) {
      return { status: "claimed" };
    }

    const rows = await this.transaction.$queryRawUnsafe<ProvisioningRequestRow[]>(
      `SELECT
         "request_hash" AS "requestHash",
         "status"::text AS "status",
         "tenant_id" AS "tenantId",
         "tenant_slug" AS "tenantSlug",
         "owner_membership_id" AS "ownerMembershipId",
         "owner_invitation_id" AS "ownerInvitationId",
         "completed_at" AS "completedAt"
       FROM "tenant_provisioning_requests"
       WHERE "idempotency_key" = $1
       FOR UPDATE`,
      input.key,
    );
    const row = rows[0];

    if (row === undefined) {
      throw new Error("Tenant provisioning idempotency claim disappeared after conflict.");
    }
    if (row.requestHash !== input.requestHash) {
      throw new TenantProvisioningIdempotencyConflictError();
    }

    return requireCompletedResult(row);
  }

  async complete(input: CompleteTenantProvisioningInput): Promise<void> {
    await this.transaction.$executeRawUnsafe(
      `UPDATE "tenant_provisioning_requests"
       SET "status" = 'completed',
           "tenant_id" = $3::uuid,
           "tenant_slug" = $4,
           "owner_membership_id" = $5::uuid,
           "owner_invitation_id" = $6::uuid,
           "completed_at" = $7,
           "updated_at" = $7
       WHERE "idempotency_key" = $1
         AND "request_hash" = $2
         AND "status" = 'in_progress'`,
      input.key,
      input.requestHash,
      input.result.tenantId,
      input.result.slug,
      input.result.ownerMembershipId,
      input.result.ownerInvitationId,
      input.completedAt,
    );
  }
}
