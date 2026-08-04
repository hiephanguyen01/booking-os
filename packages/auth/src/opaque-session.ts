import { createHash, randomBytes } from "node:crypto";

import type { PublicSession, SessionSubject } from "./session.js";

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface StoredOpaqueSession extends SessionSubject {
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface CreatedOpaqueSession {
  readonly token: string;
  readonly session: PublicSession;
}

export interface OpaqueSessionRepository {
  insert(record: StoredOpaqueSession): Promise<void>;
  find(tokenHash: string): Promise<StoredOpaqueSession | null>;
  replace(oldTokenHash: string, record: StoredOpaqueSession): Promise<boolean>;
  delete(tokenHash: string): Promise<boolean>;
}

export interface OpaqueSessionStoreOptions {
  readonly now?: () => Date;
  readonly ttlSeconds?: number;
  readonly tokenFactory?: () => string;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function assertSubject(subject: SessionSubject): void {
  if (subject.userId.trim().length === 0 || subject.tenantId.trim().length === 0) {
    throw new TypeError("Opaque sessions require non-empty user and tenant IDs.");
  }
}

function publicSession(record: StoredOpaqueSession): PublicSession {
  return {
    userId: record.userId,
    tenantId: record.tenantId,
    expiresAt: record.expiresAt.toISOString(),
  };
}

export class OpaqueSessionStore {
  private readonly now: () => Date;
  private readonly ttlSeconds: number;
  private readonly tokenFactory: () => string;

  constructor(
    private readonly repository: OpaqueSessionRepository,
    options: OpaqueSessionStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.tokenFactory = options.tokenFactory ?? createSessionToken;

    if (!Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds <= 0) {
      throw new RangeError("Session TTL must be a positive integer number of seconds.");
    }
  }

  async create(subject: SessionSubject): Promise<CreatedOpaqueSession> {
    assertSubject(subject);
    const token = this.tokenFactory();
    const now = this.now();
    const record: StoredOpaqueSession = {
      tokenHash: hashSessionToken(token),
      userId: subject.userId,
      tenantId: subject.tenantId,
      createdAt: new Date(now),
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
    };

    await this.repository.insert(record);

    return { token, session: publicSession(record) };
  }

  async read(token: string): Promise<PublicSession | null> {
    if (token.length === 0) {
      return null;
    }

    const tokenHash = hashSessionToken(token);
    const record = await this.repository.find(tokenHash);

    if (!record) {
      return null;
    }

    if (record.expiresAt.getTime() <= this.now().getTime()) {
      await this.repository.delete(tokenHash);
      return null;
    }

    return publicSession(record);
  }

  async rotate(token: string): Promise<CreatedOpaqueSession | null> {
    if (token.length === 0) {
      return null;
    }

    const oldTokenHash = hashSessionToken(token);
    const existing = await this.repository.find(oldTokenHash);

    if (!existing) {
      return null;
    }

    const now = this.now();

    if (existing.expiresAt.getTime() <= now.getTime()) {
      await this.repository.delete(oldTokenHash);
      return null;
    }

    const rotatedToken = this.tokenFactory();
    const rotatedRecord: StoredOpaqueSession = {
      tokenHash: hashSessionToken(rotatedToken),
      userId: existing.userId,
      tenantId: existing.tenantId,
      createdAt: new Date(now),
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
    };
    const replaced = await this.repository.replace(oldTokenHash, rotatedRecord);

    return replaced ? { token: rotatedToken, session: publicSession(rotatedRecord) } : null;
  }

  revoke(token: string): Promise<boolean> {
    return this.repository.delete(hashSessionToken(token));
  }
}
