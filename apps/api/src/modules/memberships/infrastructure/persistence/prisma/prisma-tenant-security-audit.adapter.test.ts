import assert from "node:assert/strict";
import test from "node:test";
import type { MembershipPrismaTransaction } from "./prisma-membership-transaction.js";
import { PrismaTenantSecurityAuditAdapter } from "./prisma-tenant-security-audit.adapter.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-11T09:00:00.000Z");

function createAdapter(): {
  readonly adapter: PrismaTenantSecurityAuditAdapter;
  readonly writes: unknown[][];
} {
  const writes: unknown[][] = [];
  const transaction: MembershipPrismaTransaction = {
    async $queryRawUnsafe<T>(): Promise<T> {
      throw new Error("unexpected query");
    },
    async $executeRawUnsafe(_sql: string, ...values: unknown[]): Promise<number> {
      writes.push(values);
      return 1;
    },
  };

  return { adapter: new PrismaTenantSecurityAuditAdapter(transaction, TENANT_ID), writes };
}

function record(metadata: Readonly<Record<string, unknown>>) {
  return {
    eventType: "membership.owner_promoted",
    actorUserId: USER_ID,
    subjectUserId: USER_ID,
    requestId: "request-1",
    metadata,
    occurredAt: NOW,
  } as const;
}

test("persists bounded tenant audit metadata", async () => {
  const { adapter, writes } = createAdapter();

  await adapter.append(
    record({
      action: "owner_promoted",
      result: "success",
      reason: "manual",
      authorizationVersion: 4,
    }),
  );

  assert.equal(writes.length, 1);
});

test("rejects sensitive tenant audit metadata before transaction persistence", async () => {
  const { adapter, writes } = createAdapter();

  await assert.rejects(adapter.append(record({ password: "hunter2" })), /security audit metadata/i);
  assert.equal(writes.length, 0);
});

test("rejects sensitive metadata nested below neutral audit keys", async () => {
  const { adapter, writes } = createAdapter();

  await assert.rejects(
    adapter.append(record({ context: { target: "owner@example.test" } })),
    /security audit metadata/i,
  );
  assert.equal(writes.length, 0);
});
