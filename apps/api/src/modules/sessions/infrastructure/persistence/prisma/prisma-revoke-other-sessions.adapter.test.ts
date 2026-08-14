import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import type { RevokeOtherSessionsInput } from "../../../application/ports/session-repository.port.js";
import { PrismaSessionRepositoryAdapter } from "./prisma-session-repository.adapter.js";

const NOW = new Date("2026-08-06T09:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const CURRENT_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_SESSION_IDS = [
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
] as const;

function revokeOthersInput(): RevokeOtherSessionsInput {
  return {
    userId: USER_ID,
    exceptSessionId: CURRENT_SESSION_ID,
    revokedAt: NOW,
    reason: "other_devices_revoked",
    audit: {
      eventType: "session.revoked",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      sessionId: CURRENT_SESSION_ID,
      requestId: "request-revoke-others",
      metadata: {
        hostname: "console.example.test",
        scopeType: "tenant",
        tenantId: TENANT_ID,
        result: "success",
      },
      occurredAt: NOW,
    },
  };
}

test("atomically revokes every active user session except the current one", async () => {
  const calls: unknown[] = [];
  const transaction = {
    authSession: {
      async findMany(input: unknown) {
        calls.push({ operation: "find-sessions", input });
        return OTHER_SESSION_IDS.map((id) => ({ id }));
      },
      async updateMany(input: unknown) {
        calls.push({ operation: "revoke-sessions", input });
        return { count: 2 };
      },
    },
    authSessionToken: {
      async updateMany(input: unknown) {
        calls.push({ operation: "revoke-tokens", input });
        return { count: 2 };
      },
    },
    securityAuditEvent: {
      async create(input: unknown) {
        calls.push({ operation: "write-audit", input });
        return input;
      },
    },
  };
  const prisma = {
    async $transaction<T>(callback: (client: typeof transaction) => Promise<T>): Promise<T> {
      return callback(transaction);
    },
  } as unknown as PrismaService;
  const adapter = new PrismaSessionRepositoryAdapter(prisma);

  assert.equal(await adapter.revokeOthersForUser(revokeOthersInput()), 2);
  assert.deepEqual(calls, [
    {
      operation: "find-sessions",
      input: {
        where: {
          userId: USER_ID,
          id: { not: CURRENT_SESSION_ID },
          revokedAt: null,
        },
        select: { id: true },
      },
    },
    {
      operation: "revoke-sessions",
      input: {
        where: { id: { in: [...OTHER_SESSION_IDS] }, revokedAt: null },
        data: {
          state: "revoked",
          revokedAt: NOW,
          revocationReason: "other_devices_revoked",
          compromisedAt: null,
          version: { increment: 1 },
          updatedAt: NOW,
        },
      },
    },
    {
      operation: "revoke-tokens",
      input: {
        where: {
          sessionId: { in: [...OTHER_SESSION_IDS] },
          revokedAt: null,
        },
        data: { revokedAt: NOW },
      },
    },
    {
      operation: "write-audit",
      input: {
        data: {
          eventType: "session.revoked",
          actorUserId: USER_ID,
          subjectUserId: USER_ID,
          requestId: "request-revoke-others",
          metadata: {
            hostname: "console.example.test",
            scopeType: "tenant",
            tenantId: TENANT_ID,
            result: "success",
            revokedCount: 2,
            sessionId: CURRENT_SESSION_ID,
          },
          occurredAt: NOW,
        },
      },
    },
  ]);
});