import {
  createSessionToken,
  deriveSessionSecretDigest,
  parseSessionToken,
  verifySessionSecretDigest,
} from "@booking-os/auth";

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SAMPLE_SESSION_DIGEST_KEY = new Uint8Array(32).fill(0x73);

export interface SampleSessionSubject {
  readonly userId: string;
  readonly tenantId: string;
}

export interface SamplePublicSession extends SampleSessionSubject {
  readonly expiresAt: string;
}

export interface CreatedSampleSession {
  readonly token: string;
  readonly session: SamplePublicSession;
}

interface StoredSampleSession extends SampleSessionSubject {
  readonly selector: string;
  readonly secretDigest: string;
  readonly expiresAt: Date;
}

export interface SampleSessionStoreOptions {
  readonly now?: () => Date;
  readonly ttlSeconds?: number;
  readonly tokenFactory?: () => string;
}

function assertSubject(subject: SampleSessionSubject): void {
  if (subject.userId.trim().length === 0 || subject.tenantId.trim().length === 0) {
    throw new TypeError("Sample sessions require non-empty user and tenant IDs.");
  }
}

function publicSession(record: StoredSampleSession): SamplePublicSession {
  return {
    userId: record.userId,
    tenantId: record.tenantId,
    expiresAt: record.expiresAt.toISOString(),
  };
}

export class SampleSessionStore {
  private readonly records = new Map<string, StoredSampleSession>();
  private readonly now: () => Date;
  private readonly ttlSeconds: number;
  private readonly tokenFactory: () => string;

  constructor(options: SampleSessionStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.tokenFactory = options.tokenFactory ?? createSessionToken;

    if (!Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds <= 0) {
      throw new RangeError("Session TTL must be a positive integer number of seconds.");
    }
  }

  async create(subject: SampleSessionSubject): Promise<CreatedSampleSession> {
    assertSubject(subject);
    return this.issue(subject, this.now());
  }

  async read(token: string): Promise<SamplePublicSession | null> {
    const record = this.findVerified(token);
    if (!record) {
      return null;
    }

    if (record.expiresAt.getTime() <= this.now().getTime()) {
      this.records.delete(record.selector);
      return null;
    }

    return publicSession(record);
  }

  async rotate(token: string): Promise<CreatedSampleSession | null> {
    const record = this.findVerified(token);
    if (!record) {
      return null;
    }

    const now = this.now();
    if (record.expiresAt.getTime() <= now.getTime()) {
      this.records.delete(record.selector);
      return null;
    }

    this.records.delete(record.selector);
    return this.issue(record, now);
  }

  async revoke(token: string): Promise<boolean> {
    const record = this.findVerified(token);
    return record ? this.records.delete(record.selector) : false;
  }

  private issue(subject: SampleSessionSubject, now: Date): CreatedSampleSession {
    const token = this.tokenFactory();
    const parsed = parseSessionToken(token);
    if (!parsed) {
      throw new TypeError("Sample session token factories must return valid opaque tokens.");
    }

    const record: StoredSampleSession = {
      selector: parsed.selector,
      secretDigest: deriveSessionSecretDigest({
        digestKey: SAMPLE_SESSION_DIGEST_KEY,
        secret: parsed.secret,
      }),
      userId: subject.userId,
      tenantId: subject.tenantId,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
    };
    this.records.set(record.selector, record);

    return { token, session: publicSession(record) };
  }

  private findVerified(token: string): StoredSampleSession | null {
    const parsed = parseSessionToken(token);
    if (!parsed) {
      return null;
    }

    const record = this.records.get(parsed.selector);
    if (
      !record ||
      !verifySessionSecretDigest({
        digestKey: SAMPLE_SESSION_DIGEST_KEY,
        secret: parsed.secret,
        expectedDigest: record.secretDigest,
      })
    ) {
      return null;
    }

    return record;
  }
}

export function createSessionStore(options: SampleSessionStoreOptions = {}): SampleSessionStore {
  return new SampleSessionStore(options);
}

export const sessionStore = createSessionStore();
