import type {
  IdentityProvisioningPort,
  IssueTenantActivationInput,
  ProvisionedIdentity,
  ProvisionIdentityInput,
} from "../../../application/ports/identity-provisioning.port.js";
import type { MembershipPrismaTransaction } from "./prisma-membership-transaction.js";

interface IdentityRow {
  readonly id: string;
  readonly status: string;
}

function mapIdentity(row: IdentityRow, created: boolean): ProvisionedIdentity {
  if (row.status === "pending_activation" || row.status === "active") {
    return Object.freeze({ userId: row.id, status: row.status, created });
  }
  throw new Error("Identity is not eligible for tenant provisioning.");
}

export class PrismaIdentityProvisioningAdapter implements IdentityProvisioningPort {
  constructor(private readonly transaction: MembershipPrismaTransaction) {}

  async findOrCreatePendingIdentity(input: ProvisionIdentityInput): Promise<ProvisionedIdentity> {
    const inserted = await this.transaction.$queryRawUnsafe<readonly IdentityRow[]>(
      `INSERT INTO "users" (
         "id", "normalized_email", "display_email", "status",
         "authorization_version", "created_at", "updated_at"
       )
       VALUES (
         gen_random_uuid(), $1, $2, 'pending_activation'::user_status,
         1, $3::timestamptz, $3::timestamptz
       )
       ON CONFLICT ("normalized_email") DO NOTHING
       RETURNING "id", "status"::text AS "status"`,
      input.normalizedEmail,
      input.displayEmail,
      input.now,
    );
    const created = inserted[0];
    if (created) return mapIdentity(created, true);

    const existing = await this.transaction.$queryRawUnsafe<readonly IdentityRow[]>(
      `SELECT "id", "status"::text AS "status"
       FROM "users"
       WHERE "normalized_email" = $1
       LIMIT 1
       FOR UPDATE`,
      input.normalizedEmail,
    );
    const row = existing[0];
    if (!row) throw new Error("Identity provisioning did not resolve a user.");
    return mapIdentity(row, false);
  }

  async issueTenantActivation(input: IssueTenantActivationInput): Promise<void> {
    await this.transaction.$executeRawUnsafe(
      `UPDATE "account_activation_tokens"
       SET "revoked_at" = $4::timestamptz
       WHERE "user_id" = $1::uuid
         AND "scope_type" = 'tenant'::identity_scope_type
         AND "tenant_id" = $2::uuid
         AND "hostname" = $3
         AND "consumed_at" IS NULL
         AND "revoked_at" IS NULL`,
      input.userId,
      input.tenantId,
      input.hostname,
      input.now,
    );
    await this.transaction.$executeRawUnsafe(
      `INSERT INTO "account_activation_tokens" (
         "id", "user_id", "scope_type", "tenant_id", "invitation_id",
         "hostname", "selector", "token_hash", "expires_at", "created_at"
       )
       VALUES (
         gen_random_uuid(), $1::uuid, 'tenant'::identity_scope_type, $2::uuid, $3::uuid,
         $4, $5, $6, $7::timestamptz, $8::timestamptz
       )`,
      input.userId,
      input.tenantId,
      input.invitationId,
      input.hostname,
      input.selector,
      input.tokenHash,
      input.expiresAt,
      input.now,
    );
  }
}
