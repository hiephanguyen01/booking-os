import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import type { RotateSessionInput } from "../../../application/ports/session-repository.port.js";
import { PrismaSessionRepositoryAdapter } from "./prisma-session-repository.adapter.js";

const NOW = new Date("2026-08-06T02:00:00.000Z");
const OVERLAP_UNTIL = new Date("2026-08-06T02:00:30.000Z");
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const CURRENT_TOKEN_ID = "44444444-4444-4444-8444-444444444444";

function successor(id: string, selector: string) {
  return {
    id,
    sessionId: SESSION_ID,
    selector,
    tokenHash: id.replaceAll("-", "").padEnd(64, "a").slice(0, 64),
    issuedAt: NOW,
    expiresAt: new Date("2026-09-05T02:00:00.000Z"),
    replacedAt: null,
    overlapUntil: null,
    successorTokenId: null,
    reuseDetectedAt: null,
    revokedAt: null,
  };
}

function rotation(successorId: string, selector: string): RotateSessionInput {
  return {
    sessionId: SESSION_ID,
    currentTokenId: CURRENT_TOKEN_ID,
    replacedAt: NOW,
    overlapUntil: OVERLAP_UNTIL,
    successor: successor(successorId, selector),
  };
}

test("two concurrent rotations create one successor and return it to the loser", async () => {
  let queue = Promise.resolve();
  let replacedAt: Date | null = null;
  let overlapUntil: Date | null = null;
  let successorTokenId: string | null = null;
  const successors = new Map<string, ReturnType<typeof successor>>();
  const transaction = {
    async $queryRawUnsafe() {
      return [
        {
          id: CURRENT_TOKEN_ID,
          sessionId: SESSION_ID,
          replacedAt,
          overlapUntil,
          successorTokenId,
          reuseDetectedAt: null,
          revokedAt: null,
        },
      ];
    },
    authSessionToken: {
      async update(input: { readonly data: Record<string, unknown> }): Promise<void> {
        if (input.data.replacedAt instanceof Date) replacedAt = input.data.replacedAt;
        if (input.data.overlapUntil instanceof Date) overlapUntil = input.data.overlapUntil;
        if (typeof input.data.successorTokenId === "string") {
          successorTokenId = input.data.successorTokenId;
        }
      },
      async create(input: { readonly data: ReturnType<typeof successor> }) {
        successors.set(input.data.id, input.data);
        return input.data;
      },
      async findUnique(input: { readonly where: { readonly id: string } }) {
        return successors.get(input.where.id) ?? null;
      },
    },
  };
  const prisma = {
    async $transaction<T>(callback: (client: typeof transaction) => Promise<T>): Promise<T> {
      const previous = queue;
      let release = (): void => undefined;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback(transaction);
      } finally {
        release();
      }
    },
  } as unknown as PrismaService;
  const adapter = new PrismaSessionRepositoryAdapter(prisma);

  const [first, second] = await Promise.all([
    adapter.rotateCompareAndSet(rotation("55555555-5555-4555-8555-555555555555", "selector-a")),
    adapter.rotateCompareAndSet(rotation("66666666-6666-4666-8666-666666666666", "selector-b")),
  ]);

  assert.equal(successors.size, 1);
  assert.deepEqual([first.status, second.status].sort(), ["existing", "rotated"]);
  const existing = first.status === "existing" ? first : second;
  assert.equal(existing.successorTokenId, [...successors.keys()][0]);
});
