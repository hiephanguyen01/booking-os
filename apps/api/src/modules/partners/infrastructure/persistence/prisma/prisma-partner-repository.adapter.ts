import type { Prisma } from "@prisma/client";

import type {
  PartnerApplicationStatus,
  PartnerOperationalStatus,
  PartnerState,
  PartnerType,
} from "../../../domain/partner.js";
import {
  PartnerNotFoundError,
  PartnerStaleVersionError,
} from "../../../domain/partner.errors.js";
import type {
  PartnerMembershipState,
  PartnerMembershipStatus,
  PartnerRepositoryPort,
  UpdatePartnerStateInput,
} from "../../../application/ports/partner-repository.port.js";

interface PartnerPersistenceRow {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly applicationStatus: string;
  readonly operationalStatus: string;
  readonly authorizationVersion: number;
  readonly version: number;
  readonly submittedAt: Date | null;
  readonly approvedAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface PartnerMembershipPersistenceRow {
  readonly id: string;
  readonly tenantId: string;
  readonly partnerId: string;
  readonly tenantMembershipId: string;
  readonly status: string;
  readonly authorizationVersion: number;
  readonly suspendedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function toPartnerType(value: string): PartnerType {
  if (value === "individual" || value === "company") return value;
  throw new PartnerNotFoundError();
}

function toApplicationStatus(value: string): PartnerApplicationStatus {
  if (value === "changesRequested" || value === "changes_requested") return "changes_requested";
  if (
    value === "draft" ||
    value === "submitted" ||
    value === "approved" ||
    value === "rejected"
  ) {
    return value;
  }
  throw new PartnerNotFoundError();
}

function toPrismaApplicationStatus(
  value: PartnerApplicationStatus,
): "draft" | "submitted" | "changesRequested" | "approved" | "rejected" {
  return value === "changes_requested" ? "changesRequested" : value;
}

function toOperationalStatus(value: string): PartnerOperationalStatus {
  if (
    value === "inactive" ||
    value === "active" ||
    value === "suspended" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new PartnerNotFoundError();
}

function toMembershipStatus(value: string): PartnerMembershipStatus {
  if (value === "active" || value === "suspended" || value === "revoked") return value;
  throw new PartnerNotFoundError();
}

function toPartnerState(row: PartnerPersistenceRow): PartnerState {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    type: toPartnerType(row.type),
    applicationStatus: toApplicationStatus(row.applicationStatus),
    operationalStatus: toOperationalStatus(row.operationalStatus),
    authorizationVersion: row.authorizationVersion,
    version: row.version,
    submittedAt: row.submittedAt,
    approvedAt: row.approvedAt,
    suspendedAt: row.suspendedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toPartnerMembershipState(row: PartnerMembershipPersistenceRow): PartnerMembershipState {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    partnerId: row.partnerId,
    tenantMembershipId: row.tenantMembershipId,
    status: toMembershipStatus(row.status),
    authorizationVersion: row.authorizationVersion,
    suspendedAt: row.suspendedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class PrismaPartnerRepositoryAdapter implements PartnerRepositoryPort {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
  ) {}

  async findById(partnerId: string): Promise<PartnerState | null> {
    const row = await this.transaction.partner.findFirst({
      where: { id: partnerId, tenantId: this.tenantId },
    });
    return row ? toPartnerState(row) : null;
  }

  async findMembership(
    partnerId: string,
    tenantMembershipId: string,
  ): Promise<PartnerMembershipState | null> {
    const row = await this.transaction.partnerMembership.findFirst({
      where: { partnerId, tenantMembershipId, tenantId: this.tenantId },
    });
    return row ? toPartnerMembershipState(row) : null;
  }

  async lockPartner(partnerId: string): Promise<PartnerState | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly PartnerPersistenceRow[]>(
      `SELECT
         "id",
         "tenant_id" AS "tenantId",
         "type"::text AS "type",
         "application_status"::text AS "applicationStatus",
         "operational_status"::text AS "operationalStatus",
         "authorization_version" AS "authorizationVersion",
         "version",
         "submitted_at" AS "submittedAt",
         "approved_at" AS "approvedAt",
         "suspended_at" AS "suspendedAt",
         "cancelled_at" AS "cancelledAt",
         "created_at" AS "createdAt",
         "updated_at" AS "updatedAt"
       FROM "partners"
       WHERE "tenant_id" = $1::uuid
         AND "id" = $2::uuid
       FOR UPDATE`,
      this.tenantId,
      partnerId,
    );
    const row = rows[0];
    return row ? toPartnerState(row) : null;
  }

  async updatePartnerState(input: UpdatePartnerStateInput): Promise<PartnerState> {
    const data: Prisma.PartnerUpdateManyMutationInput = {
      version: { increment: 1 },
    };
    const changes = input.changes;
    if (changes.applicationStatus !== undefined) {
      data.applicationStatus = toPrismaApplicationStatus(changes.applicationStatus);
    }
    if (changes.operationalStatus !== undefined) data.operationalStatus = changes.operationalStatus;
    if (changes.authorizationVersion !== undefined) {
      data.authorizationVersion = changes.authorizationVersion;
    }
    if (changes.submittedAt !== undefined) data.submittedAt = changes.submittedAt;
    if (changes.approvedAt !== undefined) data.approvedAt = changes.approvedAt;
    if (changes.suspendedAt !== undefined) data.suspendedAt = changes.suspendedAt;
    if (changes.cancelledAt !== undefined) data.cancelledAt = changes.cancelledAt;

    const result = await this.transaction.partner.updateMany({
      where: {
        id: input.partnerId,
        tenantId: this.tenantId,
        version: input.expectedVersion,
      },
      data,
    });
    if (result.count !== 1) throw new PartnerStaleVersionError();

    const updated = await this.findById(input.partnerId);
    if (!updated) throw new PartnerNotFoundError();
    return updated;
  }
}
