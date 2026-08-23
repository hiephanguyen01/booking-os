import { ARGON2ID_BASELINE } from "@booking-os/auth";
import type { Prisma } from "@prisma/client";

import {
  IdentityPasswordRequiredForPartnerRegistrationError,
  IdentityUnavailableForPartnerRegistrationError,
  type PartnerRegistrationIdentityParticipantPort,
  type ResolveVerifiedPartnerIdentityInput,
  type VerifiedPartnerIdentity,
} from "../../../application/partner-registration-identity.contract.js";
import type { PasswordDenylistPort } from "../../../application/ports/password-denylist.port.js";
import { validateNewPassword } from "../../../application/use-cases/identity-use-case-utils.js";
import { Argon2PasswordHasherAdapter } from "../../crypto/argon2-password-hasher.adapter.js";

interface ActivatedIdentityRow {
  readonly userId: string;
  readonly userAuthorizationVersion: number;
}

interface MembershipRow {
  readonly tenantMembershipId: string;
  readonly tenantMembershipAuthorizationVersion: number;
  readonly status: string;
}

const passwordDenylist: PasswordDenylistPort = Object.freeze({
  contains: async (): Promise<boolean> => false,
});

export class PrismaPartnerRegistrationIdentityParticipantAdapter
  implements PartnerRegistrationIdentityParticipantPort
{
  private readonly passwordHasher = new Argon2PasswordHasherAdapter();

  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
  ) {}

  async resolveOrCreateVerifiedIdentity(
    input: ResolveVerifiedPartnerIdentityInput,
  ): Promise<VerifiedPartnerIdentity> {
    const existing = await this.transaction.user.findUnique({
      where: { normalizedEmail: input.normalizedEmail },
      select: { id: true, status: true, authorizationVersion: true },
    });

    if (existing?.status === "active") {
      return Object.freeze({
        userId: existing.id,
        userAuthorizationVersion: existing.authorizationVersion,
        wasUserCreatedOrActivated: false,
      });
    }
    if (existing?.status === "suspended" || existing?.status === "disabled") {
      throw new IdentityUnavailableForPartnerRegistrationError();
    }
    if (!input.password) {
      throw new IdentityPasswordRequiredForPartnerRegistrationError();
    }

    const password = await validateNewPassword(input.password, passwordDenylist);
    const passwordHash = await this.passwordHasher.hash(password);
    const rows = await this.transaction.$queryRawUnsafe<readonly ActivatedIdentityRow[]>(
      `SELECT
         "user_id" AS "userId",
         "authorization_version" AS "userAuthorizationVersion"
       FROM "partner_registration_activate_or_create_identity"($1, $2, $3, $4::jsonb)`,
      input.normalizedEmail,
      input.displayEmail,
      passwordHash,
      JSON.stringify({ ...ARGON2ID_BASELINE }),
    );
    const row = rows[0];
    if (!row || rows.length !== 1) {
      throw new IdentityUnavailableForPartnerRegistrationError();
    }

    return Object.freeze({
      userId: row.userId,
      userAuthorizationVersion: row.userAuthorizationVersion,
      wasUserCreatedOrActivated: true,
    });
  }

  async ensureActiveTenantMembership(input: {
    readonly tenantId: string;
    readonly userId: string;
  }): Promise<{
    readonly tenantMembershipId: string;
    readonly tenantMembershipAuthorizationVersion: number;
    readonly wasCreated: boolean;
  }> {
    if (input.tenantId !== this.tenantId) {
      throw new IdentityUnavailableForPartnerRegistrationError();
    }

    const existing = await this.transaction.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: this.tenantId, userId: input.userId } },
      select: { id: true, status: true, authorizationVersion: true },
    });
    if (existing) {
      if (existing.status !== "active") {
        throw new IdentityUnavailableForPartnerRegistrationError();
      }
      return Object.freeze({
        tenantMembershipId: existing.id,
        tenantMembershipAuthorizationVersion: existing.authorizationVersion,
        wasCreated: false,
      });
    }

    const inserted = await this.transaction.$queryRawUnsafe<readonly MembershipRow[]>(
      `INSERT INTO "tenant_memberships" (
         "id", "tenant_id", "user_id", "status", "authorization_version",
         "accepted_at", "created_at", "updated_at"
       )
       VALUES (
         gen_random_uuid(), $1::uuid, $2::uuid, 'active'::tenant_membership_status, 1,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )
       ON CONFLICT ("tenant_id", "user_id") DO NOTHING
       RETURNING
         "id" AS "tenantMembershipId",
         "authorization_version" AS "tenantMembershipAuthorizationVersion",
         "status"::text AS "status"`,
      this.tenantId,
      input.userId,
    );

    const row = inserted[0];
    if (row) {
      return Object.freeze({
        tenantMembershipId: row.tenantMembershipId,
        tenantMembershipAuthorizationVersion: row.tenantMembershipAuthorizationVersion,
        wasCreated: true,
      });
    }

    const raced = await this.transaction.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: this.tenantId, userId: input.userId } },
      select: { id: true, status: true, authorizationVersion: true },
    });
    if (!raced || raced.status !== "active") {
      throw new IdentityUnavailableForPartnerRegistrationError();
    }

    return Object.freeze({
      tenantMembershipId: raced.id,
      tenantMembershipAuthorizationVersion: raced.authorizationVersion,
      wasCreated: false,
    });
  }
}
