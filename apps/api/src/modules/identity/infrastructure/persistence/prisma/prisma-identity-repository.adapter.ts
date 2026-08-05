import { timingSafeEqual } from "node:crypto";

import { ARGON2ID_BASELINE } from "@booking-os/auth";
import type { User as PrismaUser } from "@prisma/client";
import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  CompleteResetInput,
  ConsumeActivationInput,
  IdentityRepositoryPort,
  PasswordCredentialInput,
  PendingUserInput,
  StoredActivationToken,
  StoredResetToken,
} from "../../../application/ports/identity-repository.port.js";
import {
  IdentityEmailConflictError,
  IdentityTokenInvalidError,
} from "../../../domain/identity-errors.js";
import type { GlobalUser, IdentityScopeType } from "../../../domain/user.js";

const HEX_DIGEST_PATTERN = /^[a-f0-9]{64}$/i;

const LOCK_ACTIVATION_TOKEN_SQL = `
  SELECT
    "id",
    "user_id" AS "userId",
    "scope_type"::text AS "scopeType",
    "tenant_id" AS "tenantId",
    "invitation_id" AS "invitationId",
    "hostname",
    "selector",
    "token_hash" AS "tokenHash",
    "expires_at" AS "expiresAt",
    "consumed_at" AS "consumedAt",
    "revoked_at" AS "revokedAt",
    "created_at" AS "createdAt"
  FROM "account_activation_tokens"
  WHERE "selector" = $1
  FOR UPDATE
`;

const LOCK_PASSWORD_RESET_TOKEN_SQL = `
  SELECT
    "id",
    "user_id" AS "userId",
    "scope_type"::text AS "scopeType",
    "tenant_id" AS "tenantId",
    "hostname",
    "selector",
    "token_hash" AS "tokenHash",
    "expires_at" AS "expiresAt",
    "consumed_at" AS "consumedAt",
    "revoked_at" AS "revokedAt",
    "created_at" AS "createdAt"
  FROM "password_reset_tokens"
  WHERE "selector" = $1
  FOR UPDATE
`;

interface IdentityUserRow {
  readonly id: string;
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly status: string;
  readonly authorizationVersion: number;
  readonly activatedAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly disabledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface LockedTokenRow {
  readonly id: string;
  readonly userId: string;
  readonly scopeType: IdentityScopeType;
  readonly tenantId: string | null;
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

function mapStatus(status: string): GlobalUser["status"] {
  switch (status) {
    case "pendingActivation":
    case "pending_activation":
      return "pending_activation";
    case "active":
    case "suspended":
    case "disabled":
      return status;
    default:
      throw new Error("Unsupported identity user status.");
  }
}

function mapUser(row: IdentityUserRow | PrismaUser): GlobalUser {
  return Object.freeze({
    id: row.id,
    normalizedEmail: row.normalizedEmail,
    displayEmail: row.displayEmail,
    status: mapStatus(row.status),
    authorizationVersion: row.authorizationVersion,
    activatedAt: row.activatedAt,
    suspendedAt: row.suspendedAt,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function tokenHashesEqual(actual: string, expected: string): boolean {
  if (!HEX_DIGEST_PATTERN.test(actual) || !HEX_DIGEST_PATTERN.test(expected)) {
    return false;
  }

  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");

  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes);
}

function tokenMatchesBinding(
  row: LockedTokenRow,
  input: {
    readonly tokenHash: string;
    readonly hostname: string;
    readonly scopeType: IdentityScopeType;
    readonly tenantId: string | null;
    readonly now: Date;
  },
): boolean {
  return (
    row.hostname === input.hostname &&
    row.scopeType === input.scopeType &&
    row.tenantId === input.tenantId &&
    row.consumedAt === null &&
    row.revokedAt === null &&
    row.expiresAt.getTime() > input.now.getTime() &&
    tokenHashesEqual(row.tokenHash, input.tokenHash)
  );
}

function requireValidToken<T extends LockedTokenRow>(
  rows: readonly T[],
  input: {
    readonly tokenHash: string;
    readonly hostname: string;
    readonly scopeType: IdentityScopeType;
    readonly tenantId: string | null;
    readonly now: Date;
  },
): T {
  const row = rows[0];

  if (!row || rows.length !== 1 || !tokenMatchesBinding(row, input)) {
    throw new IdentityTokenInvalidError();
  }

  return row;
}

function credentialParameters(): Record<string, number> {
  return { ...ARGON2ID_BASELINE };
}

@Injectable()
export class PrismaIdentityRepositoryAdapter implements IdentityRepositoryPort {
  private readonly prisma: PrismaService;

  constructor(@Inject(PrismaService) prisma: PrismaService) {
    this.prisma = prisma;
  }

  async findUserByNormalizedEmail(email: string): Promise<GlobalUser | null> {
    const row = await this.prisma.user.findUnique({ where: { normalizedEmail: email } });
    return row ? mapUser(row) : null;
  }

  async createPendingUser(input: PendingUserInput): Promise<GlobalUser> {
    try {
      const row = await this.prisma.user.create({
        data: {
          normalizedEmail: input.normalizedEmail,
          displayEmail: input.displayEmail,
          status: "pendingActivation",
          authorizationVersion: 1,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return mapUser(row);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new IdentityEmailConflictError();
      }
      throw error;
    }
  }

  async storePasswordCredential(input: PasswordCredentialInput): Promise<void> {
    const parameters = credentialParameters();
    await this.prisma.passwordCredential.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        passwordHash: input.passwordHash,
        algorithm: "argon2id",
        parameters,
        passwordChangedAt: input.changedAt,
        createdAt: input.changedAt,
        updatedAt: input.changedAt,
      },
      update: {
        passwordHash: input.passwordHash,
        algorithm: "argon2id",
        parameters,
        passwordChangedAt: input.changedAt,
        updatedAt: input.changedAt,
      },
    });
  }

  async issueActivationToken(input: StoredActivationToken): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.accountActivationToken.updateMany({
        where: {
          userId: input.userId,
          scopeType: input.scopeType,
          tenantId: input.tenantId,
          hostname: input.hostname,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: input.createdAt },
      });
      await transaction.accountActivationToken.create({ data: { ...input } });
    });
  }

  async issuePasswordResetToken(input: StoredResetToken): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.passwordResetToken.updateMany({
        where: {
          userId: input.userId,
          scopeType: input.scopeType,
          tenantId: input.tenantId,
          hostname: input.hostname,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: input.createdAt },
      });
      await transaction.passwordResetToken.create({ data: { ...input } });
    });
  }

  async consumeActivationToken(input: ConsumeActivationInput): Promise<GlobalUser> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRawUnsafe<LockedTokenRow[]>(
        LOCK_ACTIVATION_TOKEN_SQL,
        input.selector,
      );
      const token = requireValidToken(rows, input);

      await transaction.accountActivationToken.update({
        where: { id: token.id },
        data: { consumedAt: input.now },
      });
      const user = await transaction.user.update({
        where: { id: token.userId },
        data: {
          status: "active",
          activatedAt: input.now,
          updatedAt: input.now,
        },
      });

      return mapUser(user);
    });
  }

  async replacePasswordAndConsumeReset(input: CompleteResetInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRawUnsafe<LockedTokenRow[]>(
        LOCK_PASSWORD_RESET_TOKEN_SQL,
        input.selector,
      );
      const token = requireValidToken(rows, input);
      const parameters = credentialParameters();

      await transaction.passwordCredential.upsert({
        where: { userId: token.userId },
        create: {
          userId: token.userId,
          passwordHash: input.passwordHash,
          algorithm: "argon2id",
          parameters,
          passwordChangedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
        update: {
          passwordHash: input.passwordHash,
          algorithm: "argon2id",
          parameters,
          passwordChangedAt: input.now,
          updatedAt: input.now,
        },
      });
      await transaction.passwordResetToken.update({
        where: { id: token.id },
        data: { consumedAt: input.now },
      });
      await transaction.passwordResetToken.updateMany({
        where: {
          id: { not: token.id },
          userId: token.userId,
          scopeType: token.scopeType,
          tenantId: token.tenantId,
          hostname: token.hostname,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: input.now },
      });
      await transaction.user.update({
        where: { id: token.userId },
        data: {
          authorizationVersion: { increment: 1 },
          updatedAt: input.now,
        },
      });
    });
  }
}
