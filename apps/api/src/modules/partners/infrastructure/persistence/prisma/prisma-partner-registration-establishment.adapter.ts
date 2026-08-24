import type { Prisma } from "@prisma/client";

import type { PartnerRegistrationEstablishmentPort } from "../../../application/ports/partner-registration-establishment.port.js";

interface IdRow {
  readonly id: string;
}

export class PrismaPartnerRegistrationEstablishmentAdapter
  implements PartnerRegistrationEstablishmentPort
{
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
  ) {}

  async createPartner(input: {
    readonly challengeId: string;
    readonly partnerType: "individual" | "company";
    readonly now: Date;
  }): Promise<{ readonly partnerId: string }> {
    const rows = await this.transaction.$queryRawUnsafe<readonly IdRow[]>(
      `INSERT INTO "partners" (
         "id", "tenant_id", "registration_challenge_id", "type",
         "application_status", "operational_status", "authorization_version", "version",
         "created_at", "updated_at"
       )
       VALUES (
         gen_random_uuid(), $1::uuid, $2::uuid, $3::partner_type,
         'draft'::partner_application_status, 'inactive'::partner_operational_status, 1, 1,
         $4, $4
       )
       RETURNING "id"`,
      this.tenantId,
      input.challengeId,
      input.partnerType,
      input.now,
    );
    const row = rows[0];
    if (!row || rows.length !== 1) throw new Error("Partner establishment failed.");
    return Object.freeze({ partnerId: row.id });
  }

  async createPartnerMembership(input: {
    readonly partnerId: string;
    readonly tenantMembershipId: string;
    readonly now: Date;
  }): Promise<{ readonly partnerMembershipId: string }> {
    const rows = await this.transaction.$queryRawUnsafe<readonly IdRow[]>(
      `INSERT INTO "partner_memberships" (
         "id", "tenant_id", "partner_id", "tenant_membership_id", "status",
         "authorization_version", "created_at", "updated_at"
       )
       VALUES (
         gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'active'::partner_membership_status,
         1, $4, $4
       )
       RETURNING "id"`,
      this.tenantId,
      input.partnerId,
      input.tenantMembershipId,
      input.now,
    );
    const row = rows[0];
    if (!row || rows.length !== 1) throw new Error("Partner membership establishment failed.");
    return Object.freeze({ partnerMembershipId: row.id });
  }

  async assignPartnerOwner(input: {
    readonly partnerId: string;
    readonly partnerMembershipId: string;
    readonly now: Date;
  }): Promise<void> {
    const rows = await this.transaction.$queryRawUnsafe<readonly IdRow[]>(
      `INSERT INTO "partner_system_role_assignments" (
         "id", "tenant_id", "partner_id", "partner_membership_id", "role_id", "created_at"
       )
       SELECT gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, role_row."id", $4
       FROM "roles" AS role_row
       WHERE role_row."key" = 'partner_owner'
         AND role_row."scope_level" = 'partner'::role_scope_level
         AND role_row."is_system" IS TRUE
       RETURNING "id"`,
      this.tenantId,
      input.partnerId,
      input.partnerMembershipId,
      input.now,
    );
    if (rows.length !== 1) throw new Error("Partner owner role establishment failed.");
  }

  async appendRegistrationHistory(input: {
    readonly partnerId: string;
    readonly applicationStatus:
      | "draft"
      | "submitted"
      | "changes_requested"
      | "approved"
      | "rejected";
    readonly operationalStatus: "inactive" | "active" | "suspended" | "cancelled";
    readonly occurredAt: Date;
  }): Promise<void> {
    await this.transaction.$executeRawUnsafe(
      `INSERT INTO "partner_status_history" (
         "id", "tenant_id", "partner_id", "application_status", "operational_status", "occurred_at"
       )
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::partner_application_status, $4::partner_operational_status, $5)`,
      this.tenantId,
      input.partnerId,
      input.applicationStatus,
      input.operationalStatus,
      input.occurredAt,
    );
  }

  async appendRegistrationOutbox(input: {
    readonly partnerId: string;
    readonly occurredAt: Date;
  }): Promise<void> {
    await this.transaction.$executeRawUnsafe(
      `INSERT INTO "outbox_events" (
         "id", "tenant_id", "type", "aggregate_type", "aggregate_id", "payload",
         "occurred_at", "available_at"
       )
       VALUES (
         gen_random_uuid(), $1::uuid, 'partner.registration.completed', 'partner', $2::uuid,
         $3::jsonb, $4, $4
       )`,
      this.tenantId,
      input.partnerId,
      JSON.stringify({ partnerId: input.partnerId }),
      input.occurredAt,
    );
  }
}
