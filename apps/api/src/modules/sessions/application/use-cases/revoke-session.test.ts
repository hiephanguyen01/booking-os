import assert from "node:assert/strict";
import test from "node:test";

import type { SessionSecurityAuditRecord } from "../ports/security-audit.port.js";
import { RevokeSessionUseCase } from "./revoke-session.js";
import {
  createSecurityAudit,
  createSessionRepository,
  NOW,
  SESSION_ID,
  USER_ID,
} from "./session-use-case-test-doubles.js";

test("revokes one owned session and records the explicit reason", async () => {
  const revoked: unknown[] = [];
  const auditRecords: SessionSecurityAuditRecord[] = [];
  const useCase = new RevokeSessionUseCase(
    createSessionRepository({
      async revokeById(input) {
        revoked.push(input);
        return true;
      },
    }),
    createSecurityAudit(auditRecords),
    { now: () => NOW },
  );

  assert.deepEqual(
    await useCase.execute({
      sessionId: SESSION_ID,
      userId: USER_ID,
      reason: "logout",
      requestId: "request-revoke-session",
    }),
    { revoked: true },
  );
  assert.deepEqual(revoked, [
    {
      sessionId: SESSION_ID,
      userId: USER_ID,
      revokedAt: NOW,
      reason: "logout",
    },
  ]);
  assert.deepEqual(auditRecords, [
    {
      eventType: "session.revoked",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      sessionId: SESSION_ID,
      requestId: "request-revoke-session",
      metadata: { reason: "logout" },
      occurredAt: NOW,
    },
  ]);
});

test("does not emit an audit record when the owned session is absent", async () => {
  const auditRecords: SessionSecurityAuditRecord[] = [];
  const useCase = new RevokeSessionUseCase(
    createSessionRepository(),
    createSecurityAudit(auditRecords),
    { now: () => NOW },
  );

  assert.deepEqual(
    await useCase.execute({
      sessionId: SESSION_ID,
      userId: USER_ID,
      reason: "user_requested",
      requestId: "request-missing-session",
    }),
    { revoked: false },
  );
  assert.deepEqual(auditRecords, []);
});
