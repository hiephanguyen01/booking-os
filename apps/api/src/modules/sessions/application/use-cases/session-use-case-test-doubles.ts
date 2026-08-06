import { createSessionToken } from "@booking-os/auth";
import type {
  SessionSecurityAuditPort,
  SessionSecurityAuditRecord,
} from "../ports/security-audit.port.js";
import type {
  RotationResult,
  SessionRepositoryPort,
  StoredSession,
  StoredSessionToken,
  StoredSessionWithToken,
} from "../ports/session-repository.port.js";

export const NOW = new Date("2026-08-06T02:00:00.000Z");
export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const TENANT_ID = "22222222-2222-4222-8222-222222222222";
export const SESSION_ID = "33333333-3333-4333-8333-333333333333";
export const TOKEN_ID = "44444444-4444-4444-8444-444444444444";
export const SUCCESSOR_ID = "55555555-5555-4555-8555-555555555555";
export const HOSTNAME = "console.example.test";
export const DIGEST_KEY = new Uint8Array(32).fill(0x6b);
export const TOKEN = createSessionToken({ randomBytes: (size) => Buffer.alloc(size, 0x31) });
export const SUCCESSOR_TOKEN = createSessionToken({
  randomBytes: (size) => Buffer.alloc(size, 0x52),
});

interface StoredSessionOverrides {
  readonly session?: Partial<StoredSession>;
  readonly token?: Partial<StoredSessionToken>;
}

export function storedSession(overrides: StoredSessionOverrides = {}): StoredSessionWithToken {
  const session: StoredSession = {
    id: SESSION_ID,
    userId: USER_ID,
    scope: { type: "tenant", tenantId: TENANT_ID },
    hostname: HOSTNAME,
    state: "active",
    authorizationVersion: 4,
    version: 1,
    idleExpiresAt: new Date("2026-08-13T02:00:00.000Z"),
    absoluteExpiresAt: new Date("2026-09-05T02:00:00.000Z"),
    lastSeenAt: new Date("2026-08-06T01:50:00.000Z"),
    revokedAt: null,
    revocationReason: null,
    compromisedAt: null,
    createdAt: new Date("2026-08-06T01:30:00.000Z"),
    updatedAt: new Date("2026-08-06T01:30:00.000Z"),
    ...overrides.session,
  };
  const token: StoredSessionToken = {
    id: TOKEN_ID,
    sessionId: SESSION_ID,
    selector: "MTExMTExMTExMTExMTExMTEx",
    tokenHash: "a".repeat(64),
    issuedAt: new Date("2026-08-06T01:40:00.000Z"),
    expiresAt: session.absoluteExpiresAt,
    replacedAt: null,
    overlapUntil: null,
    successorTokenId: null,
    reuseDetectedAt: null,
    revokedAt: null,
    ...overrides.token,
  };

  return { session, token };
}

export function createSessionRepository(
  overrides: Partial<SessionRepositoryPort> = {},
): SessionRepositoryPort {
  return {
    async create(): Promise<never> {
      throw new Error("Unexpected session create.");
    },
    async findBySelector(): Promise<StoredSessionWithToken | null> {
      return null;
    },
    async rotateCompareAndSet(): Promise<RotationResult> {
      return { status: "unavailable" };
    },
    async markCompromised(): Promise<void> {},
    async touchIfDue(): Promise<void> {},
    async revokeById(): Promise<boolean> {
      return false;
    },
    async revokeAllForUser(): Promise<number> {
      return 0;
    },
    async listForUser(): Promise<readonly never[]> {
      return [];
    },
    ...overrides,
  };
}

export function createSecurityAudit(
  records: SessionSecurityAuditRecord[],
): SessionSecurityAuditPort {
  return {
    async record(record): Promise<void> {
      records.push(record);
    },
  };
}
