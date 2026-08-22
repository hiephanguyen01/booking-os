import type { GlobalUser } from "../domain/user.js";

export interface ResolveVerifiedPartnerIdentityInput {
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly password?: string;
}

export interface VerifiedPartnerIdentity {
  readonly userId: string;
  readonly userAuthorizationVersion: number;
  readonly wasUserCreatedOrActivated: boolean;
}

export interface CreateActiveVerifiedPartnerIdentityInput {
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly passwordHash: string;
  readonly now: Date;
}

export interface ActivatePendingPartnerIdentityInput {
  readonly userId: string;
  readonly passwordHash: string;
  readonly now: Date;
}

export interface PartnerRegistrationIdentityPersistencePort {
  findUserByNormalizedEmail(normalizedEmail: string): Promise<GlobalUser | null>;
  createActiveVerifiedUser(input: CreateActiveVerifiedPartnerIdentityInput): Promise<GlobalUser>;
  activatePendingUser(input: ActivatePendingPartnerIdentityInput): Promise<GlobalUser>;
}

export interface PartnerRegistrationIdentityContract {
  resolveOrCreateVerifiedIdentity(
    input: ResolveVerifiedPartnerIdentityInput,
  ): Promise<VerifiedPartnerIdentity>;
}

export interface PartnerRegistrationIdentityParticipantPort
  extends PartnerRegistrationIdentityContract {
  ensureActiveTenantMembership(input: {
    readonly tenantId: string;
    readonly userId: string;
  }): Promise<{
    readonly tenantMembershipId: string;
    readonly tenantMembershipAuthorizationVersion: number;
    readonly wasCreated: boolean;
  }>;
}

export class IdentityUnavailableForPartnerRegistrationError extends Error {
  readonly code = "IDENTITY_UNAVAILABLE_FOR_PARTNER_REGISTRATION";

  constructor() {
    super("Identity is unavailable for Partner registration.");
    this.name = new.target.name;
  }
}

export class IdentityPasswordRequiredForPartnerRegistrationError extends Error {
  readonly code = "IDENTITY_PASSWORD_REQUIRED_FOR_PARTNER_REGISTRATION";

  constructor() {
    super("A valid password is required to establish this Partner identity.");
    this.name = new.target.name;
  }
}
