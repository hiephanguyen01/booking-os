import { deriveLoginAttemptKey } from "../login-abuse-key.js";
import type { CredentialVerifierPort } from "../ports/credential-verifier.port.js";
import type { LoginAbuseProtectionPort } from "../ports/login-abuse-protection.port.js";
import type { SessionScope, StoredSession } from "../ports/session-repository.port.js";
import type { SessionSubjectPort } from "../ports/session-subject.port.js";
import type { CreateSessionInput } from "./create-session.js";

export class InvalidLoginError extends Error {
  override readonly name = "InvalidLoginError";

  constructor() {
    super("The supplied credentials or account scope are invalid.");
  }
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly ipAddress: string;
  readonly hostname: string;
  readonly scope: SessionScope;
  readonly requestId: string;
}

export interface LoginOptions {
  readonly abuseHmacKey: Uint8Array;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

interface SessionIssuer {
  execute(
    input: CreateSessionInput,
  ): Promise<{ readonly token: string; readonly session: StoredSession }>;
}

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

export class LoginUseCase {
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(
    private readonly credentials: CredentialVerifierPort,
    private readonly subjects: SessionSubjectPort,
    private readonly abuse: LoginAbuseProtectionPort,
    private readonly sessions: SessionIssuer,
    private readonly options: LoginOptions,
  ) {
    this.sleep = options.sleep ?? sleep;
  }

  private async rejectLogin(
    attemptKey: Parameters<LoginAbuseProtectionPort["recordFailure"]>[0],
  ): Promise<never> {
    await this.abuse.recordFailure(attemptKey);
    throw new InvalidLoginError();
  }

  async execute(
    input: LoginInput,
  ): Promise<{ readonly token: string; readonly session: StoredSession }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const attemptKey = deriveLoginAttemptKey({
      hmacKey: this.options.abuseHmacKey,
      normalizedEmail,
      ipAddress: input.ipAddress,
    });
    const { delayMs } = await this.abuse.beforeAttempt(attemptKey);
    if (delayMs > 0) {
      await this.sleep(delayMs);
    }

    const credential = await this.credentials.verify({
      normalizedEmail,
      password: input.password,
    });
    if (credential?.status !== "active") {
      return this.rejectLogin(attemptKey);
    }

    const subject = await this.subjects.resolveForLogin({
      userId: credential.userId,
      hostname: input.hostname,
      scope: input.scope,
    });
    if (!subject) {
      return this.rejectLogin(attemptKey);
    }

    if (credential.passwordNeedsRehash) {
      await this.credentials.rehashPassword({
        userId: credential.userId,
        password: input.password,
      });
    }

    await this.abuse.recordSuccess(attemptKey);
    return this.sessions.execute({
      userId: credential.userId,
      scope: input.scope,
      hostname: input.hostname,
      state: subject.state,
      authorizationVersion: subject.authorizationVersion,
      ...(subject.membershipAuthorizationVersion === undefined
        ? {}
        : { membershipAuthorizationVersion: subject.membershipAuthorizationVersion }),
      requestId: input.requestId,
    });
  }
}
