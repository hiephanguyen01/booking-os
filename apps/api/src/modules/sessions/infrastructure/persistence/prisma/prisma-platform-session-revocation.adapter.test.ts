import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaPlatformSessionRevocationAdapter } from "./prisma-platform-session-revocation.adapter.js";

const NOW = new Date("2026-08-11T10:00:00.000Z");
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

function input() {
  return {
    actorUserId: ACTOR_ID,
    targetUserId: TARGET_ID,
    revokedAt: NOW,
    revocationReason: "platform_incident:suspected_account_compromise",
    requestId: "request-1",
    hostname: "console.example.test",
  } as const;
}

function fakePrisma(options: { readonly failAudit?: boolean } = {}): {
  readonly prisma: PrismaService;
  readonly operations: string[];
  readonly auditWrites: unknown[];
} {
  const operations: string[] = [];
  const auditWrites: unknown[] = [];
  const transaction = {
    authSession: {
      async findMany() {
        operations.push("find_sessions");
        return [{ id: "session-1" }, { id: "session-2" }];
      },
      async updateMany() {
        operations.push("update_sessions");
        return { count: 2 };
      },
    },
    authSessionToken: {
      async updateMany() {
        operations.push("update_tokens");
        return { count: 2 };
      },
    },
    securityAuditEvent: {
      async create(args: unknown) {
        operations.push("audit");
        auditWrites.push(args);
        if (options.failAudit) throw new Error("audit write failed");
        return args;
      },
    },
  };
  const prisma = {
    async $transaction<T>(callback: (client: typeof transaction) => Promise<T>): Promise<T> {
      operations.push("begin");
      try {
        const result = await callback(transaction);
        operations.push("commit");
        return result;
      } catch (error: unknown) {
        operations.push("rollback");
        throw error;
      }
    },
  } as unknown as PrismaService;

  return { prisma, operations, auditWrites };
}

test("revokes sessions and persists sanitized audit in one Prisma transaction", async () => {
  const { prisma, operations, auditWrites } = fakePrisma();
  const adapter = new PrismaPlatformSessionRevocationAdapter(prisma);

  const count = await adapter.revokeAllForUserAndAudit(input());

  assert.equal(count, 2);
  assert.deepEqual(operations, [
    "begin",
    "find_sessions",
    "update_sessions",
    "update_tokens",
    "audit",
    "commit",
  ]);
  assert.equal(auditWrites.length, 1);
  assert.deepEqual(auditWrites[0], {
    data: {
      eventType: "session.revoked",
      actorUserId: ACTOR_ID,
      subjectUserId: TARGET_ID,
      requestId: "request-1",
      metadata: {
        action: "revoke_all",
        result: "success",
        reason: "security_incident",
        hostname: "console.example.test",
        scopeType: "platform",
        revokedSessionCount: 2,
      },
      occurredAt: NOW,
    },
  });
});

test("fails the transaction when the security audit write fails", async () => {
  const { prisma, operations } = fakePrisma({ failAudit: true });
  const adapter = new PrismaPlatformSessionRevocationAdapter(prisma);

  await assert.rejects(adapter.revokeAllForUserAndAudit(input()), /audit write failed/);
  assert.deepEqual(operations, [
    "begin",
    "find_sessions",
    "update_sessions",
    "update_tokens",
    "audit",
    "rollback",
  ]);
});
