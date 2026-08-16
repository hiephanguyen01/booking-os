import type { GlobalUser, IdentityScopeType } from "../../domain/user.js";

export interface PendingUserInput {
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly now: Date;
  readonly requestedByUserId: string;
  readonly requestId: string | null;
  readonly hostname: string;
  readonly scopeType: IdentityScopeType;
  readonly tenantId: string | null;
}

export interface PasswordCredentialInput {
  readonly userId: string;
  readonly passwordHash: string;
  readonly changedAt: Date;
}

export interface StoredActivationToken {
  readonly id: string;
  readonly userId: string;
  readonly scopeType: IdentityScopeType;
  readonly tenantId: string | null;
  readonly invitationId: string | null;
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface StoredResetToken {
  readonly id: string;
  readonly userId: string;
  readonly scopeType: IdentityScopeType;
  readonly tenantId: string | null;
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface ConsumeActivationInput {
  readonly selector: string;
  readonly tokenHash: string;
  readonly hostname: string;
  readonly scopeType: IdentityScopeType;
  readonly tenantId: string | null;
  readonly passwordHash: string;
  readonly now: Date;
  readonly requestId: string | null;
}

export interface ActivationConsumptionResult extends GlobalUser {
  readonly invitationId?: string | null;
  readonly intendedRoleKey?: string | null;
}

export interface CompleteResetInput {
  readonly selector: string;
  readonly tokenHash: string;
  readonly hostname: string;
  readonly scopeType: IdentityScopeType;
  readonly tenantId: string | null;
  readonly passwordHash: string;
  readonly now: Date;
  readonly requestId: string | null;
}

export interface PasswordResetResult {
  readonly userId: string;
}

export interface IdentityRepositoryPort {
  findUserByNormalizedEmail(email: string): Promise<GlobalUser | null>;
  createPendingUser(input: PendingUserInput): Promise<GlobalUser>;
  storePasswordCredential(input: PasswordCredentialInput): Promise<void>;
  issueActivationToken(input: StoredActivationToken): Promise<void>;
  issuePasswordResetToken(input: StoredResetToken): Promise<void>;
  consumeActivationToken(input: ConsumeActivationInput): Promise<ActivationConsumptionResult>;
  replacePasswordAndConsumeReset(input: CompleteResetInput): Promise<PasswordResetResult>;
}
