import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaSessionSecurityAuditAdapter } from "./prisma-session-security-audit.adapter.js";

const NOW = new Date("2026-08-11T08:30:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function createAdapter(): {
  readonly adapter: PrismaSessionSecurityAuditAdapter;
  readonly writes: unknown[];
} {
  const writes: unknown[] = [];
  const prisma = {
    securityAuditEvent: {
      async create(input: unknown): Promise<void> {
        writes.push(input);
      },
    },
  } as unknown as PrismaService;

  return { adapter: new PrismaSessionSecurityAuditAdapter(prisma), writes };
}

test("allows bounded session reasons such as token_reuse", async () => {
  const { adapter, writes } = createAdapter();

  await adapter.record({
    eventType: "session.reuse_detected",
    actorUserId: USER_ID,
    subjectUserId: USER_ID,
    sessionId: SESSION_ID,
    requestId: "request-1",
    metadata: { reason: "token_reuse", result: "denied" },
    occurredAt: NOW,
  });

  assert.equal(writes.length, 1);
});

test("rejects prohibited session audit metadata before persistence", async () => {
  const { adapter, writes } = createAdapter();

  await assert.rejects(
    adapter.record({
      eventType: "session.reuse_detected",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      sessionId: SESSION_ID,
      requestId: "request-1",
      metadata: { reason: "token_reuse", password: "hunter2" },
      occurredAt: NOW,
    }),
    /security audit metadata/i,
  );

  assert.equal(writes.length, 0);
});

test("rejects raw email values even under otherwise neutral keys", async () => {
  const { adapter, writes } = createAdapter();

  await assert.rejects(
    adapter.record({
      eventType: "session.revoked",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      sessionId: SESSION_ID,
      requestId: "request-1",
      metadata: { reason: "manual", target: "owner@example.test" },
      occurredAt: NOW,
    }),
    /security audit metadata/i,
  );

  assert.equal(writes.length, 0);
});
