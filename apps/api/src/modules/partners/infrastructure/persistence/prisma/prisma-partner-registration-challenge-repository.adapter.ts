import type { Prisma } from "@prisma/client";

import type {
  PartnerRegistrationChallengeRecord,
  PartnerRegistrationChallengeRepositoryPort,
  UpsertPartnerRegistrationChallengeInput,
} from "../../../application/ports/partner-registration-challenge-repository.port.js";
import type { PartnerType } from "../../../domain/partner.js";

interface PartnerRegistrationChallengeRow {
  readonly id: string;
  readonly tenantId: string;
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly partnerType: PartnerType;
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly completedPartnerId: string | null;
  readonly createdAt: Date;
}

function mapChallenge(row: PartnerRegistrationChallengeRow): PartnerRegistrationChallengeRecord {
  return Object.freeze({ ...row });
}

const CHALLENGE_COLUMNS = `
  "id",
  "tenant_id" AS "tenantId",
  "normalized_email" AS "normalizedEmail",
  "display_email" AS "displayEmail",
  "partner_type"::text AS "partnerType",
  "hostname",
  "selector",
  "token_hash" AS "tokenHash",
  "expires_at" AS "expiresAt",
  "consumed_at" AS "consumedAt",
  "revoked_at" AS "revokedAt",
  "completed_partner_id" AS "completedPartnerId",
  "created_at" AS "createdAt"
`;

export class PrismaPartnerRegistrationChallengeRepositoryAdapter
  implements PartnerRegistrationChallengeRepositoryPort
{
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
  ) {}

  async upsertForEmail(
    input: UpsertPartnerRegistrationChallengeInput,
  ): Promise<PartnerRegistrationChallengeRecord> {
    const rows = await this.transaction.$queryRawUnsafe<readonly PartnerRegistrationChallengeRow[]>(
      `WITH upserted AS (
         INSERT INTO "partner_registration_challenges" (
           "tenant_id", "normalized_email", "display_email", "partner_type", "hostname",
           "selector", "token_hash", "expires_at", "created_at"
         )
         VALUES ($1::uuid, $2, $3, $4::partner_type, $5, $6, $7, $8, $9)
         ON CONFLICT ("tenant_id", "normalized_email") DO UPDATE
         SET "display_email" = EXCLUDED."display_email",
             "partner_type" = EXCLUDED."partner_type",
             "hostname" = EXCLUDED."hostname",
             "selector" = EXCLUDED."selector",
             "token_hash" = EXCLUDED."token_hash",
             "expires_at" = EXCLUDED."expires_at",
             "consumed_at" = NULL,
             "revoked_at" = NULL
         WHERE "partner_registration_challenges"."completed_partner_id" IS NULL
         RETURNING ${CHALLENGE_COLUMNS}
       )
       SELECT * FROM upserted
       UNION ALL
       SELECT ${CHALLENGE_COLUMNS}
       FROM "partner_registration_challenges"
       WHERE "tenant_id" = $1::uuid
         AND "normalized_email" = $2
         AND NOT EXISTS (SELECT 1 FROM upserted)
       LIMIT 1`,
      this.tenantId,
      input.normalizedEmail,
      input.displayEmail,
      input.partnerType,
      input.hostname,
      input.selector,
      input.tokenHash,
      input.expiresAt,
      input.now,
    );
    const row = rows[0];
    if (!row) throw new Error("Partner registration challenge upsert failed.");
    return mapChallenge(row);
  }

  async lockBySelector(selector: string): Promise<PartnerRegistrationChallengeRecord | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly PartnerRegistrationChallengeRow[]>(
      `SELECT ${CHALLENGE_COLUMNS}
       FROM "partner_registration_challenges"
       WHERE "tenant_id" = $1::uuid
         AND "selector" = $2
       FOR UPDATE`,
      this.tenantId,
      selector,
    );
    const row = rows[0];
    return row && rows.length === 1 ? mapChallenge(row) : null;
  }

  async markCompleted(input: {
    readonly challengeId: string;
    readonly partnerId: string;
    readonly consumedAt: Date;
  }): Promise<void> {
    await this.transaction.$executeRawUnsafe(
      `UPDATE "partner_registration_challenges"
       SET "completed_partner_id" = $3::uuid,
           "consumed_at" = $4
       WHERE "tenant_id" = $1::uuid
         AND "id" = $2::uuid
         AND "completed_partner_id" IS NULL`,
      this.tenantId,
      input.challengeId,
      input.partnerId,
      input.consumedAt,
    );
  }
}
