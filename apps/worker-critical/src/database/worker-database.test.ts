import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma, PrismaClient } from "@prisma/client";

import { WorkerDatabase } from "./worker-database.js";

interface FakeTransaction {
  readonly $executeRawUnsafe: (query: string) => Promise<number>;
}

function createDatabase(events: string[]): {
  readonly database: WorkerDatabase;
  readonly transaction: FakeTransaction;
  readonly transactionCalls: () => number;
} {
  let calls = 0;
  const transaction: FakeTransaction = {
    async $executeRawUnsafe(query) {
      events.push(query);
      return 0;
    },
  };
  const prisma = {
    async $transaction<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      calls += 1;
      events.push("transaction");
      return work(transaction as unknown as Prisma.TransactionClient);
    },
  } as unknown as PrismaClient;

  return {
    database: new WorkerDatabase(prisma),
    transaction,
    transactionCalls: () => calls,
  };
}

test("opens one transaction and sets the fixed worker role before callback", async () => {
  const events: string[] = [];
  const { database, transaction, transactionCalls } = createDatabase(events);

  const result = await database.run(async (activeTransaction) => {
    assert.equal(activeTransaction, transaction);
    events.push("callback");
    return "done";
  });

  assert.equal(result, "done");
  assert.equal(transactionCalls(), 1);
  assert.deepEqual(events, ["transaction", "SET LOCAL ROLE booking_worker", "callback"]);
  assert.equal(database.run.length, 1);
});

test("propagates callback failures", async () => {
  const events: string[] = [];
  const { database } = createDatabase(events);
  const sentinel = new Error("worker-database-sentinel");

  await assert.rejects(
    database.run(async () => {
      throw sentinel;
    }),
    (error) => error === sentinel,
  );
});
