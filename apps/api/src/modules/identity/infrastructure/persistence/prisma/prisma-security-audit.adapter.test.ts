import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaSecurityAuditAdapter } from "./prisma-security-audit.adapter.js";

const NOW = new Date("2026-08-11T08:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";

function createAdapter(): {
  readonly adapter: PrismaSecurityAuditAdapter;
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

  return { adapter: new PrismaSecurityAuditAdapter(prisma), writes };
}

test("persists a bounded security audit record", async () => {
  const { adapter, writes } = createAdapter();

  await adapter.record({
    eventType: "identity.activation.completed",
    actorUserId: USER_ID,
    subjectUserId: USER_ID,
    requestId: "request-1",
    metadata: {
      action: "user.activate",
      result: "success",
      reason: "completed",
      hostname: "console.example.com",
      scopeType: "platform",
    },
    occurredAt: NOW,
  });

  assert.equal(writes.length, 1);
  assert.doesNotMatch(JSON.stringify(writes[0]), /password|cookie|authorization|bearer|token|envelope/i);
});

for (const [key, value] of [
  ["password", "hunter2"],
  ["cookie", "booking_session=opaque"],
  ["authorization", "Bearer raw-token"],
  ["token", "raw-token"],
  ["envelope", "ciphertext"],
  ["email", "owner@example.test"],
] as const) {
  test(`rejects prohibited security audit metadata: ${key}`, async () => {
    const { adapter, writes } = createAdapter();

    await assert.rejects(
      adapter.record({
        eventType: "identity.security.test",
        actorUserId: USER_ID,
        subjectUserId: USER_ID,
        requestId: "request-1",
        metadata: {
          action: "security.test",
          result: "denied",
          reason: "policy",
          hostname: "console.example.com",
          [key]: value,
        },
        occurredAt: NOW,
      }),
      /security audit metadata/i,
    );

    assert.equal(writes.length, 0);
  });
}
