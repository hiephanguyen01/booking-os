import { IdentityTokenInvalidError } from "../../domain/identity-errors.js";
import type { IdentityScopeType } from "../../domain/user.js";
import type { ClockPort } from "../ports/clock.port.js";
import type { IdentityRepositoryPort } from "../ports/identity-repository.port.js";
import type { OneTimeTokenPort } from "../ports/one-time-token.port.js";
import type { PasswordDenylistPort } from "../ports/password-denylist.port.js";
import type { PasswordHasherPort } from "../ports/password-hasher.port.js";
import {
  identityTokenPurpose,
  normalizeHostname,
  resolveTenantId,
  validateNewPassword,
} from "./identity-use-case-utils.js";

export interface CompleteActivationCommand {
  readonly hostname: string;
  readonly token: string;
  readonly newPassword: string;
  readonly scopeType: IdentityScopeType;
  readonly tenantId?: string;
  readonly requestId: string | null;
}

export interface CompleteActivationResult {
  readonly userId: string;
  readonly continuationEmail?: string;
}

export class CompleteActivationUseCase {
  constructor(
    private readonly repository: IdentityRepositoryPort,
    private readonly tokens: OneTimeTokenPort,
    private readonly passwordHasher: PasswordHasherPort,
    private readonly passwordDenylist: PasswordDenylistPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(command: CompleteActivationCommand): Promise<CompleteActivationResult> {
    const hostname = normalizeHostname(command.hostname);
    const tenantId = resolveTenantId(command.scopeType, command.tenantId);
    const purpose = identityTokenPurpose("activation", command.scopeType, tenantId, hostname);
    const derived = this.tokens.derive(command.token, purpose);

    if (!derived) {
      throw new IdentityTokenInvalidError();
    }

    const normalizedPassword = await validateNewPassword(
      command.newPassword,
      this.passwordDenylist,
    );
    const passwordHash = await this.passwordHasher.hash(normalizedPassword);
    const now = this.clock.now();
    const user = await this.repository.consumeActivationToken({
      selector: derived.selector,
      tokenHash: derived.tokenHash,
      hostname,
      scopeType: command.scopeType,
      tenantId,
      passwordHash,
      now,
      requestId: command.requestId,
    });

    return Object.freeze({
      userId: user.id,
      ...(command.scopeType === "tenant" ? { continuationEmail: user.normalizedEmail } : {}),
    });
  }
}
