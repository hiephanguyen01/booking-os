import assert from "node:assert/strict";
import test from "node:test";

import {
  MembershipError,
  TenantProvisioningIdempotencyConflictError,
} from "../../../domain/membership-errors.js";
import { PrismaTenantProvisioningIdempotencyAdapter } from "./prisma-tenant-provisioning-idempotency.adapter.js";

const now = new Date("2026-08-07T05:20:00.000Z");
const completedAt = new Date("2026-08-07T05:21:00.000Z");
const requestHash = "a".repeat(64);

interface RecordedQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class RecordingTransaction {
  readonly queries: RecordedQuery[] = [];
  readonly executions: RecordedQuery[] = [];
  readonly results: unknown[][] = [];

  async $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T> {
    this.queries.push({ sql, values });
    return (this.results.shift() ?? []) as T;
  }

  async $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number> {
    this.executions.push({ sql, values });
    return 1;
  }
}

function completedRow(overrides: Record<string, unknown> = {}) {
  return {
    requestHash,
    status: "completed",
    tenantId: "30000000-0000-4000-8000-000000000001",
    tenantSlug: "acme",
    ownerMembershipId: "40000000-0000-4000-8000-000000000001",
    ownerInvitationId: "50000000-0000-4000-8000-000000000001",
    completedAt,
    ...overrides,
  };
}

test("claims a new idempotency key exactly once", async () => {
  const transaction = new RecordingTransaction();
  transaction.results.push([{ inserted: true }]);
  const adapter = new PrismaTenantProvisioningIdempotencyAdapter(transaction);

  const result = await adapter.claim({
    key: "create-acme",
    requestHash,
    actorUserId: "10000000-0000-4000-8000-000000000001",
    now,
  });

  assert.deepEqual(result, { status: "claimed" });
  assert.equal(transaction.queries.length, 1);
  assert.match(transaction.queries[0]?.sql ?? "", /INSERT INTO "tenant_provisioning_requests"/);
  assert.match(transaction.queries[0]?.sql ?? "", /ON CONFLICT .* DO NOTHING/i);
  assert.deepEqual(transaction.queries[0]?.values, [
    "create-acme",
    requestHash,
    "10000000-0000-4000-8000-000000000001",
    now,
  ]);
});

test("replays a completed result for the same key and request hash", async () => {
  const transaction = new RecordingTransaction();
  transaction.results.push([]);
  transaction.results.push([completedRow()]);
  const adapter = new PrismaTenantProvisioningIdempotencyAdapter(transaction);

  const result = await adapter.claim({
    key: "create-acme",
    requestHash,
    actorUserId: "10000000-0000-4000-8000-000000000001",
    now,
  });

  assert.deepEqual(result, {
    status: "completed",
    result: {
      tenantId: "30000000-0000-4000-8000-000000000001",
      slug: "acme",
      status: "provisioning",
      ownerMembershipId: "40000000-0000-4000-8000-000000000001",
      ownerInvitationId: "50000000-0000-4000-8000-000000000001",
      replayed: true,
    },
  });
  assert.equal(transaction.queries.length, 2);
  assert.match(transaction.queries[1]?.sql ?? "", /FOR UPDATE/i);
  assert.deepEqual(transaction.queries[1]?.values, ["create-acme"]);
});

test("rejects reusing an idempotency key with a different payload", async () => {
  const transaction = new RecordingTransaction();
  transaction.results.push([]);
  transaction.results.push([completedRow({ requestHash: "b".repeat(64) })]);
  const adapter = new PrismaTenantProvisioningIdempotencyAdapter(transaction);

  await assert.rejects(
    adapter.claim({
      key: "create-acme",
      requestHash,
      actorUserId: "10000000-0000-4000-8000-000000000001",
      now,
    }),
    TenantProvisioningIdempotencyConflictError,
  );
});

test("reports an in-progress idempotency key as a stable domain conflict", async () => {
  const transaction = new RecordingTransaction();
  transaction.results.push([]);
  transaction.results.push([completedRow({ status: "in_progress", completedAt: null })]);
  const adapter = new PrismaTenantProvisioningIdempotencyAdapter(transaction);

  await assert.rejects(
    adapter.claim({
      key: "create-acme",
      requestHash,
      actorUserId: "10000000-0000-4000-8000-000000000001",
      now,
    }),
    (error: unknown) =>
      error instanceof MembershipError && error.code === "TENANT_PROVISIONING_IN_PROGRESS",
  );
});

test("stores the completed provisioning result without changing the request fingerprint", async () => {
  const transaction = new RecordingTransaction();
  const adapter = new PrismaTenantProvisioningIdempotencyAdapter(transaction);

  await adapter.complete({
    key: "create-acme",
    requestHash,
    result: {
      tenantId: "30000000-0000-4000-8000-000000000001",
      slug: "acme",
      status: "provisioning",
      ownerMembershipId: "40000000-0000-4000-8000-000000000001",
      ownerInvitationId: "50000000-0000-4000-8000-000000000001",
      replayed: false,
    },
    completedAt,
  });

  assert.equal(transaction.executions.length, 1);
  assert.match(transaction.executions[0]?.sql ?? "", /UPDATE "tenant_provisioning_requests"/);
  assert.match(transaction.executions[0]?.sql ?? "", /request_hash/);
  assert.deepEqual(transaction.executions[0]?.values, [
    "create-acme",
    requestHash,
    "30000000-0000-4000-8000-000000000001",
    "acme",
    "40000000-0000-4000-8000-000000000001",
    "50000000-0000-4000-8000-000000000001",
    completedAt,
  ]);
});
