import type { SystemRole } from "@booking-os/auth";

import type {
  CreateMembershipInvitationInput,
  InvitationRepositoryPort,
} from "../../../application/ports/invitation-repository.port.js";
import { InvitationInvalidOrExpiredError } from "../../../domain/membership-errors.js";
import type {
  MembershipInvitation,
  MembershipInvitationStatus,
} from "../../../domain/membership-invitation.js";
import type { MembershipPrismaTransaction } from "./prisma-membership-transaction.js";

interface InvitationRow {
  readonly id: string;
  readonly tenantId: string;
  readonly normalizedEmail: string;
  readonly invitedUserId: string | null;
  readonly intendedRoleKey: SystemRole;
  readonly status: MembershipInvitationStatus;
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly invitedByUserId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const INVITATION_COLUMNS = `
  "id",
  "tenant_id" AS "tenantId",
  "normalized_email" AS "normalizedEmail",
  "invited_user_id" AS "invitedUserId",
  "intended_role_key" AS "intendedRoleKey",
  "status"::text AS "status",
  "hostname",
  "selector",
  "token_hash" AS "tokenHash",
  "expires_at" AS "expiresAt",
  "accepted_at" AS "acceptedAt",
  "revoked_at" AS "revokedAt",
  "invited_by_user_id" AS "invitedByUserId",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"
`;

function firstInvitation(rows: readonly InvitationRow[]): MembershipInvitation | null {
  const row = rows[0];
  return row ? Object.freeze({ ...row }) : null;
}

function requireInvitation(rows: readonly InvitationRow[]): MembershipInvitation {
  const invitation = firstInvitation(rows);
  if (!invitation) {
    throw new InvitationInvalidOrExpiredError();
  }
  return invitation;
}

export class PrismaInvitationRepositoryAdapter implements InvitationRepositoryPort {
  constructor(
    private readonly transaction: MembershipPrismaTransaction,
    private readonly tenantId: string,
  ) {}

  async findPendingByEmailAndRole(
    normalizedEmail: string,
    intendedRoleKey: SystemRole,
  ): Promise<MembershipInvitation | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly InvitationRow[]>(
      `SELECT ${INVITATION_COLUMNS}
       FROM "membership_invitations"
       WHERE "tenant_id" = $1::uuid
         AND "normalized_email" = $2
         AND "intended_role_key" = $3
         AND "status" = 'pending'::membership_invitation_status
         AND "revoked_at" IS NULL
       ORDER BY "created_at" DESC
       LIMIT 1`,
      this.tenantId,
      normalizedEmail,
      intendedRoleKey,
    );
    return firstInvitation(rows);
  }

  async findCurrentForUser(userId: string): Promise<MembershipInvitation | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly InvitationRow[]>(
      `SELECT ${INVITATION_COLUMNS}
       FROM "membership_invitations"
       WHERE "tenant_id" = $1::uuid
         AND "invited_user_id" = $2::uuid
         AND "status" = 'pending'::membership_invitation_status
         AND "revoked_at" IS NULL
       ORDER BY "created_at" DESC
       LIMIT 1`,
      this.tenantId,
      userId,
    );
    return firstInvitation(rows);
  }

  async lockBySelector(selector: string): Promise<MembershipInvitation | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly InvitationRow[]>(
      `SELECT ${INVITATION_COLUMNS}
       FROM "membership_invitations"
       WHERE "tenant_id" = $1::uuid AND "selector" = $2
       FOR UPDATE`,
      this.tenantId,
      selector,
    );
    return firstInvitation(rows);
  }

  async create(input: CreateMembershipInvitationInput): Promise<MembershipInvitation> {
    const rows = await this.transaction.$queryRawUnsafe<readonly InvitationRow[]>(
      `INSERT INTO "membership_invitations" (
         "id", "tenant_id", "normalized_email", "invited_user_id",
         "intended_role_key", "status", "hostname", "selector", "token_hash",
         "expires_at", "invited_by_user_id", "created_at", "updated_at"
       )
       VALUES (
         gen_random_uuid(), $1::uuid, $2, $3::uuid, $4,
         'pending'::membership_invitation_status, $5, $6, $7,
         $8::timestamptz, $9::uuid, $10::timestamptz, $10::timestamptz
       )
       RETURNING ${INVITATION_COLUMNS}`,
      this.tenantId,
      input.normalizedEmail,
      input.invitedUserId,
      input.intendedRoleKey,
      input.hostname,
      input.selector,
      input.tokenHash,
      input.expiresAt,
      input.invitedByUserId,
      input.now,
    );
    return requireInvitation(rows);
  }

  async revoke(id: string, now: Date): Promise<void> {
    await this.transaction.$executeRawUnsafe(
      `UPDATE "membership_invitations"
       SET "status" = 'revoked'::membership_invitation_status,
           "revoked_at" = $3::timestamptz,
           "updated_at" = $3::timestamptz
       WHERE "tenant_id" = $1::uuid AND "id" = $2::uuid`,
      this.tenantId,
      id,
      now,
    );
  }

  async accept(id: string, now: Date): Promise<void> {
    const affected = await this.transaction.$executeRawUnsafe(
      `UPDATE "membership_invitations"
       SET "status" = 'accepted'::membership_invitation_status,
           "accepted_at" = $3::timestamptz,
           "updated_at" = $3::timestamptz
       WHERE "tenant_id" = $1::uuid
         AND "id" = $2::uuid
         AND "status" = 'pending'::membership_invitation_status
         AND "revoked_at" IS NULL
         AND "expires_at" > $3::timestamptz`,
      this.tenantId,
      id,
      now,
    );
    if (affected !== 1) {
      throw new InvitationInvalidOrExpiredError();
    }
  }
}
