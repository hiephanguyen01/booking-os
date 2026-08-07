import type {
  CreateProvisioningTenantInput,
  NewlyProvisionedTenant,
  ProvisioningTenant,
  ProvisioningTenantStatus,
  TenantProvisioningRepositoryPort,
} from "../../../application/ports/tenant-provisioning.port.js";
import { TenantNotAvailableError } from "../../../domain/membership-errors.js";
import type { MembershipPrismaTransaction } from "./prisma-membership-transaction.js";

interface TenantRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: ProvisioningTenantStatus;
}

const TENANT_COLUMNS = `"id", "slug", "name", "status"::text AS "status"`;

function firstTenant(rows: readonly TenantRow[]): ProvisioningTenant | null {
  const row = rows[0];
  return row ? Object.freeze({ ...row }) : null;
}

function requireTenant(rows: readonly TenantRow[]): ProvisioningTenant {
  const tenant = firstTenant(rows);
  if (!tenant) {
    throw new TenantNotAvailableError();
  }
  return tenant;
}

function requireNewlyProvisionedTenant(rows: readonly TenantRow[]): NewlyProvisionedTenant {
  const tenant = requireTenant(rows);
  if (tenant.status !== "provisioning") {
    throw new TenantNotAvailableError();
  }
  return Object.freeze({ ...tenant, status: "provisioning" });
}

export class PrismaTenantProvisioningRepositoryAdapter implements TenantProvisioningRepositoryPort {
  constructor(
    private readonly transaction: MembershipPrismaTransaction,
    private readonly tenantId: string,
  ) {}

  async findCurrent(): Promise<ProvisioningTenant | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly TenantRow[]>(
      `SELECT ${TENANT_COLUMNS}
       FROM "tenants"
       WHERE "id" = $1::uuid`,
      this.tenantId,
    );
    return firstTenant(rows);
  }

  async lockCurrent(): Promise<ProvisioningTenant | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly TenantRow[]>(
      `SELECT ${TENANT_COLUMNS}
       FROM "tenants"
       WHERE "id" = $1::uuid
       FOR UPDATE`,
      this.tenantId,
    );
    return firstTenant(rows);
  }

  async createProvisioning(
    input: CreateProvisioningTenantInput,
  ): Promise<NewlyProvisionedTenant> {
    const rows = await this.transaction.$queryRawUnsafe<readonly TenantRow[]>(
      `INSERT INTO "tenants" ("id", "slug", "name", "status", "created_at")
       VALUES ($1::uuid, $2, $3, 'provisioning'::tenant_status, $4::timestamptz)
       RETURNING ${TENANT_COLUMNS}`,
      this.tenantId,
      input.slug,
      input.name,
      input.now,
    );
    return requireNewlyProvisionedTenant(rows);
  }

  async addPrimaryDomain(hostname: string, now: Date): Promise<void> {
    await this.transaction.$executeRawUnsafe(
      `INSERT INTO "tenant_domains" (
         "id", "tenant_id", "hostname", "is_primary", "created_at"
       )
       VALUES (gen_random_uuid(), $1::uuid, $2, TRUE, $3::timestamptz)`,
      this.tenantId,
      hostname,
      now,
    );
  }

  async activate(_now: Date): Promise<void> {
    const affected = await this.transaction.$executeRawUnsafe(
      `UPDATE "tenants"
       SET "status" = 'active'::tenant_status
       WHERE "id" = $1::uuid`,
      this.tenantId,
    );
    if (affected !== 1) {
      throw new TenantNotAvailableError();
    }
  }

  async suspend(_now: Date): Promise<void> {
    const affected = await this.transaction.$executeRawUnsafe(
      `UPDATE "tenants"
       SET "status" = 'suspended'::tenant_status
       WHERE "id" = $1::uuid`,
      this.tenantId,
    );
    if (affected !== 1) {
      throw new TenantNotAvailableError();
    }
  }
}
