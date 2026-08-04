import {
  OpaqueSessionStore,
  type OpaqueSessionRepository,
  type OpaqueSessionStoreOptions,
  type StoredOpaqueSession,
} from "@booking-os/auth";

export class InMemoryOpaqueSessionRepository implements OpaqueSessionRepository {
  private readonly records = new Map<string, StoredOpaqueSession>();

  async insert(record: StoredOpaqueSession): Promise<void> {
    this.records.set(record.tokenHash, structuredClone(record));
  }

  async find(tokenHash: string): Promise<StoredOpaqueSession | null> {
    const record = this.records.get(tokenHash);
    return record ? structuredClone(record) : null;
  }

  async replace(oldTokenHash: string, record: StoredOpaqueSession): Promise<boolean> {
    if (!this.records.has(oldTokenHash)) {
      return false;
    }

    this.records.delete(oldTokenHash);
    this.records.set(record.tokenHash, structuredClone(record));
    return true;
  }

  async delete(tokenHash: string): Promise<boolean> {
    return this.records.delete(tokenHash);
  }
}

export function createSessionStore(options: OpaqueSessionStoreOptions = {}): OpaqueSessionStore {
  return new OpaqueSessionStore(new InMemoryOpaqueSessionRepository(), options);
}

export const sessionStore = createSessionStore();
