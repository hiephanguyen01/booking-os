import type { ClockPort } from "../ports/clock.port.js";
import type {
  IdentityRepositoryPort,
  PendingUserInput,
} from "../ports/identity-repository.port.js";
import type {
  IdentityOutboxPort,
  IssueIdentityEmailInput,
} from "../ports/identity-outbox.port.js";
import type { OneTimeTokenPort } from "../ports/one-time-token.port.js";
import type { PasswordDenylistPort } from "../ports/password-denylist.port.js";
import type { PasswordHasherPort } from "../ports/password-hasher.port.js";
import type {
  SecurityAuditPort,
  SecurityAuditRecord,
} from "../ports/security-audit.port.js";
import type { SensitiveEnvelopePort } from "../ports/sensitive-envelope.port.js";
import type { SessionRevocationPort } from "../ports/session-revocation.port.js";
import type { GlobalUser } from "../../domain/user.js";

export const NOW = new Date("2026-08-05T09:00:00.000Z");
export const HOSTNAME = "console.example.com";
export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const REQUESTED_BY_USER_ID = "22222222-2222-4222-8222-222222222222";
export const TENANT_ID = "33333333-3333-4333-8333-333333333333";
export const INVITATION_ID = "44444444-4444-4444-8444-444444444444";
export const SERIALIZED_TOKEN = `${"a".repeat(22)}.${"b".repeat(43)}`;
export const TOKEN_HASH = "c".repeat(64);

export function createUser(overrides: Partial<GlobalUser> = {}): GlobalUser {
  return Object.freeze({
    id: USER_ID,
    normalizedEmail: "owner@example.com",
    displayEmail: "Owner@example.com",
    status: "pending_activation",
    authorizationVersion: 1,
    activatedAt: null,
    suspendedAt: null,
    disabledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

export function createIdentityRepository(
  overrides: Partial<IdentityRepositoryPort> = {},
): IdentityRepositoryPort {
  return {
    async findUserByNormalizedEmail(): Promise<GlobalUser | null> {
      return null;
    },
    async createPendingUser(input: PendingUserInput): Promise<GlobalUser> {
      return createUser({
        normalizedEmail: input.normalizedEmail,
        displayEmail: input.displayEmail,
        createdAt: input.now,
        updatedAt: input.now,
      });
    },
    async storePasswordCredential(): Promise<void> {},
    async issueActivationToken(): Promise<void> {},
    async issuePasswordResetToken(): Promise<void> {},
    async consumeActivationToken(): Promise<GlobalUser> {
      return createUser({ status: "active", activatedAt: NOW });
    },
    async replacePasswordAndConsumeReset(): Promise<{ readonly userId: string }> {
      return { userId: USER_ID };
    },
    ...overrides,
  };
}

export function createIdentityOutbox(
  overrides: Partial<IdentityOutboxPort> = {},
): IdentityOutboxPort {
  return {
    async issueActivation(_input: IssueIdentityEmailInput): Promise<void> {},
    async issuePasswordReset(_input: IssueIdentityEmailInput): Promise<void> {},
    ...overrides,
  };
}

export function createOneTimeTokenPort(
  overrides: Partial<OneTimeTokenPort> = {},
): OneTimeTokenPort {
  return {
    issue(): { selector: string; serialized: string; tokenHash: string } {
      return {
        selector: "a".repeat(22),
        serialized: SERIALIZED_TOKEN,
        tokenHash: TOKEN_HASH,
      };
    },
    derive(): { selector: string; tokenHash: string } {
      return { selector: "a".repeat(22), tokenHash: TOKEN_HASH };
    },
    verify(): { selector: string } {
      return { selector: "a".repeat(22) };
    },
    ...overrides,
  };
}

export function createSensitiveEnvelopePort(
  onSeal?: (plaintext: Uint8Array, associatedData: Uint8Array) => void,
): SensitiveEnvelopePort {
  return {
    seal(plaintext: Uint8Array, associatedData: Uint8Array) {
      onSeal?.(plaintext, associatedData);
      return {
        version: 1,
        keyId: "key-1",
        iv: "iv",
        ciphertext: "ciphertext",
        tag: "tag",
      } as const;
    },
    open(): Uint8Array {
      throw new Error("not used by identity use-case tests");
    },
  };
}

export const fixedClock: ClockPort = Object.freeze({
  now: (): Date => new Date(NOW),
});

export function createPasswordHasher(
  overrides: Partial<PasswordHasherPort> = {},
): PasswordHasherPort {
  return {
    async hash(): Promise<string> {
      return "$argon2id$v=19$m=65536,t=3,p=1$test$hash";
    },
    async verify(): Promise<boolean> {
      return true;
    },
    needsRehash(): boolean {
      return false;
    },
    ...overrides,
  };
}

export function createPasswordDenylist(
  overrides: Partial<PasswordDenylistPort> = {},
): PasswordDenylistPort {
  return {
    async contains(): Promise<boolean> {
      return false;
    },
    ...overrides,
  };
}

export function createSecurityAudit(
  records: SecurityAuditRecord[],
  overrides: Partial<SecurityAuditPort> = {},
): SecurityAuditPort {
  return {
    async record(record: SecurityAuditRecord): Promise<void> {
      records.push(record);
    },
    ...overrides,
  };
}

export function createSessionRevocation(
  calls: Array<{ readonly userId: string; readonly revokedAt: Date }>,
): SessionRevocationPort {
  return {
    async revokeAllForUser(userId: string, revokedAt: Date): Promise<void> {
      calls.push({ userId, revokedAt });
    },
  };
}
