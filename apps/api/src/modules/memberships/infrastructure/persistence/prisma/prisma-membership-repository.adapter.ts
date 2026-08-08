import type {
  CreateInvitedMembershipInput,
  MembershipRepositoryPort,
} from "../../../application/ports/membership-repository.port.js";
import { MembershipRequiredError } from "../../../domain/membership-errors.js";
import type {
  TenantMembership,
  TenantMembershipStatus,
} from "../../../domain/tenant-membership.js";
import type { MembershipPrismaTransaction } from "./prisma-membership-transaction.js";

interface MembershipRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly status: TenantMembershipStatus;
  readonly authorizationVersion: number;
  readonly acceptedAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const MEMBERSHIP_COLUMNS = `
  "id",
  "tenant_id" AS "tenantId",
  "user_id" AS "userId",
  "status"::text AS "status",
  "authorization_version" AS "authorizationVersion",
  "accepted_at" AS "acceptedAt",
  "suspended_at" AS "suspendedAt",
  "revoked_at" AS "revokedAt",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"
`;

function mapMembership(row: MembershipRow): TenantMembership {
  return Object.freeze({ ...row });
}

function firstMembership(rows: readonly MembershipRow[]): TenantMembership | null {
  const row = rows[0];
  return row ? mapMembership(row) : null;
}

function requireMembership(rows: readonly MembershipRow[]): TenantMembership {
  const membership = firstMembership(rows);
  if (!membership) {
    throw new MembershipRequiredError();
  }
  return membership;
}

export class PrismaMembershipRepositoryAdapter implements MembershipRepositoryPort {
  constructor(
    private readonly transaction: MembershipPrismaTransaction,
    private readonly tenantId: string,
  ) {}

  async list(): Promise<readonly TenantMembership[]> {
    const rows = await this.transaction.$queryRawUnsafe<readonly MembershipRow[]>(
      `SELECT ${MEMBERSHIP_COLUMNS}
       FROM "tenant_memberships"
       WHERE "tenant_id" = $1::uuid
       ORDER BY "created_at", "id"`,
      this.tenantId,
    );
    return Object.freeze(rows.map(mapMembership));
  }

  async findById(id: string): Promise<TenantMembership | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly MembershipRow[]>(
      `SELECT ${MEMBERSHIP_COLUMNS}
       FROM "tenant_memberships"
       WHERE "tenant_id" = $1::uuid AND "id" = $2::uuid`,
      this.tenantId,
      id,
    );
    return firstMembership(rows);
  }

  async findByUserId(userId: string): Promise<TenantMembership | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly MembershipRow[]>(
      `SELECT ${MEMBERSHIP_COLUMNS}
       FROM "tenant_memberships"
       WHERE "tenant_id" = $1::uuid AND "user_id" = $2::uuid`,
      this.tenantId,
      userId,
    );
    return firstMembership(rows);
  }

  async lockById(id: string): Promise<TenantMembership | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly MembershipRow[]>(
      `SELECT ${MEMBERSHIP_COLUMNS}
       FROM "tenant_memberships"
       WHERE "tenant_id" = $1::uuid AND "id" = $2::uuid
       FOR UPDATE`,
      this.tenantId,
      id,
    );
    return firstMembership(rows);
  }

  async createInvited(input: CreateInvitedMembershipInput): Promise<TenantMembership> {
    const rows = await this.transaction.$queryRawUnsafe<readonly MembershipRow[]>(
      `INSERT INTO "tenant_memberships" (
         "id", "tenant_id", "user_id", "status", "authorization_version",
         "created_at", "updated_at"
       )
       VALUES (
         gen_random_uuid(), $1::uuid, $2::uuid, 'invited'::tenant_membership_status,
         1, $3::timestamptz, $3::timestamptz
       )
       RETURNING ${MEMBERSHIP_COLUMNS}`,
      this.tenantId,
      input.userId,
      input.now,
    );
    return requireMembership(rows);
  }

  async activate(id: string, now: Date): Promise<TenantMembership> {
    return this.updateLifecycle(id, "active", now);
  }

  async suspend(id: string, now: Date): Promise<TenantMembership> {
    return this.updateLifecycle(id, "suspended", now);
  }

  async revoke(id: string, now: Date): Promise<TenantMembership> {
    return this.updateLifecycle(id, "revoked", now);
  }

  async incrementAuthorizationVersion(id: string, now: Date): Promise<number> {
    const rows = await this.transaction.$queryRawUnsafe<
      readonly { authorizationVersion: number }[]
    >(
      `UPDATE "tenant_memberships"
       SET "authorization_version" = "authorization_version" + 1,
           "updated_at" = $3::timestamptz
       WHERE "tenant_id" = $1::uuid AND "id" = $2::uuid
       RETURNING "authorization_version" AS "authorizationVersion"`,
      this.tenantId,
      id,
      now,
    );
    const version = rows[0]?.authorizationVersion;
    if (!version) {
      throw new MembershipRequiredError();
    }
    return version;
  }

  private async updateLifecycle(
    id: string,
    status: "active" | "suspended" | "revoked",
    now: Date,
  ): Promise<TenantMembership> {
    const acceptedAt = status === "active" ? now : null;
    const suspendedAt = status === "suspended" ? now : null;
    const revokedAt = status === "revoked" ? now : null;
    const rows = await this.transaction.$queryRawUnsafe<readonly MembershipRow[]>(
      `UPDATE "tenant_memberships"
       SET "status" = $3::tenant_membership_status,
           "accepted_at" = COALESCE("accepted_at", $4::timestamptz),
           "suspended_at" = $5::timestamptz,
           "revoked_at" = $6::timestamptz,
           "authorization_version" = "authorization_version" + 1,
           "updated_at" = $4::timestamptz
       WHERE "tenant_id" = $1::uuid AND "id" = $2::uuid
       RETURNING ${MEMBERSHIP_COLUMNS}`,
      this.tenantId,
      id,
      status,
      now,
      suspendedAt,
      revokedAt,
    );
    const membership = requireMembership(rows);
    if (status === "active" && acceptedAt === null) {
      throw new MembershipRequiredError();
    }
    return membership;
  }
}
