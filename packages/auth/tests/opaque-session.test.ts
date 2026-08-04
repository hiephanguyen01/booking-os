import assert from "node:assert/strict";
import test from "node:test";

import {
  hashSessionToken,
  type OpaqueSessionRepository,
  OpaqueSessionStore,
  type StoredOpaqueSession,
} from "../src/opaque-session.js";

class MemorySessionRepository implements OpaqueSessionRepository {
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

  hasRawValue(value: string): boolean {
    return [...this.records.keys()].includes(value);
  }

  hasHash(value: string): boolean {
    return this.records.has(value);
  }
}

const fixedNow = new Date("2026-08-04T00:00:00.000Z");

function createStore(repository: MemorySessionRepository): OpaqueSessionStore {
  return new OpaqueSessionStore(repository, {
    now: () => fixedNow,
    ttlSeconds: 60 * 60,
  });
}

test("stores only the hash of the presented token", async () => {
  const repository = new MemorySessionRepository();
  const store = createStore(repository);

  const created = await store.create({ userId: "user-1", tenantId: "tenant-1" });

  assert.equal(created.token.length >= 43, true);
  assert.equal(repository.hasRawValue(created.token), false);
  assert.equal(repository.hasHash(hashSessionToken(created.token)), true);
  assert.deepEqual(created.session, {
    userId: "user-1",
    tenantId: "tenant-1",
    expiresAt: "2026-08-04T01:00:00.000Z",
  });
});

test("rotation invalidates the old token", async () => {
  const repository = new MemorySessionRepository();
  const store = createStore(repository);
  const first = await store.create({ userId: "user-1", tenantId: "tenant-1" });

  const rotated = await store.rotate(first.token);

  assert.notEqual(rotated, null);
  assert.equal(await store.read(first.token), null);
  assert.equal((await store.read(rotated?.token ?? ""))?.userId, "user-1");
});

test("expired and revoked sessions cannot be read", async () => {
  const repository = new MemorySessionRepository();
  let now = fixedNow;
  const store = new OpaqueSessionStore(repository, {
    now: () => now,
    ttlSeconds: 60,
  });
  const created = await store.create({ userId: "user-1", tenantId: "tenant-1" });

  now = new Date("2026-08-04T00:02:00.000Z");
  assert.equal(await store.read(created.token), null);

  const second = await store.create({ userId: "user-2", tenantId: "tenant-2" });
  assert.equal(await store.revoke(second.token), true);
  assert.equal(await store.read(second.token), null);
});
