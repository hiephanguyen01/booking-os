import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaAuthorizationSecurityAuditAdapter } from "./prisma-authorization-security-audit.adapter.js";

const NOW = new Date("2026-08-12T02:30:00.000Z");
const USER_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "20000000-0000-4000-8000-000000000001";
const TENANT_ID = "30000000-0000-4000-8000-000000000001";

test("persists only the bounded canonical authorization denial record", async () => {
  const writes: unknown[] = [];
  const prisma = {
    securityAuditEvent: {
      async create(input: unknown) {
        writes.push(input);
        return input;
      },
    },
  } as unknown as PrismaService;
  const adapter = new PrismaAuthorizationSecurityAuditAdapter(prisma);

  await adapter.recordDenied({
    eventType: "authorization.denied",
    actorUserId: USER_ID,
    subjectUserId: USER_ID,
    sessionId: SESSION_ID,
    requestId: "request-permission",
    permission: "tenant.membership.read",
    scopeType: "tenant",
    tenantId: TENANT_ID,
    reason: "authority_mismatch",
    occurredAt: NOW,
  });

  assert.deepEqual(writes, [
    {
      data: {
        eventType: "authorization.denied",
        actorUserId: USER_ID,
        subjectUserId: USER_ID,
        requestId: "request-permission",
        metadata: {
          permission: "tenant.membership.read",
          scopeType: "tenant",
          tenantId: TENANT_ID,
          reason: "authority_mismatch",
          sessionId: SESSION_ID,
          result: "denied",
        },
        occurredAt: NOW,
      },
    },
  ]);
});
