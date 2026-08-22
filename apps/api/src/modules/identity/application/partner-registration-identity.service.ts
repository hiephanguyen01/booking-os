import {
  IdentityPasswordRequiredForPartnerRegistrationError,
  IdentityUnavailableForPartnerRegistrationError,
  type PartnerRegistrationIdentityContract,
  type PartnerRegistrationIdentityPersistencePort,
  type ResolveVerifiedPartnerIdentityInput,
  type VerifiedPartnerIdentity,
} from "./partner-registration-identity.contract.js";
import type { PasswordDenylistPort } from "./ports/password-denylist.port.js";
import type { PasswordHasherPort } from "./ports/password-hasher.port.js";
import { validateNewPassword } from "./use-cases/identity-use-case-utils.js";

export class PartnerRegistrationIdentityService implements PartnerRegistrationIdentityContract {
  constructor(
    private readonly persistence: PartnerRegistrationIdentityPersistencePort,
    private readonly passwordHasher: PasswordHasherPort,
    private readonly passwordDenylist: PasswordDenylistPort,
    private readonly now: () => Date,
  ) {}

  async resolveOrCreateVerifiedIdentity(
    input: ResolveVerifiedPartnerIdentityInput,
  ): Promise<VerifiedPartnerIdentity> {
    const existing = await this.persistence.findUserByNormalizedEmail(input.normalizedEmail);

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

    const password = await validateNewPassword(input.password, this.passwordDenylist);
    const passwordHash = await this.passwordHasher.hash(password);
    const now = this.now();
    const resolved = existing
      ? await this.persistence.activatePendingUser({
          userId: existing.id,
          passwordHash,
          now,
        })
      : await this.persistence.createActiveVerifiedUser({
          normalizedEmail: input.normalizedEmail,
          displayEmail: input.displayEmail,
          passwordHash,
          now,
        });

    return Object.freeze({
      userId: resolved.id,
      userAuthorizationVersion: resolved.authorizationVersion,
      wasUserCreatedOrActivated: true,
    });
  }
}
