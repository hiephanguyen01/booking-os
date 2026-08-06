import assert from "node:assert/strict";
import test from "node:test";

import type { SessionSecurityAuditRecord } from "../ports/security-audit.port.js";
import { RevokeOtherSessionsUseCase } from "./revoke-other-sessions.js";
import {
  createSecurityAudit,
  createSessionRepository,
  NOW,
  SESSION_ID,
  USER_ID,
} from "./session-use-case-test-doubles.js";

test("revokes every other session and records one aggregate audit event", async () => {
  const revoked: unknown[] = [];
  const auditRecords: SessionSecurityAuditRecord[] = [];
  const useCase = new RevokeOtherSessionsUseCase(
    createSessionRepository({
      async revokeOthersForUser(input) {
        revoked.push(input);
        return 2;
      },
    }),
    createSecurityAudit(auditRecords),
    { now: () => NOW },
  );

  assert.deepEqual(
    await useCase.execute({
      userId: USER_ID,
      currentSessionId: SESSION_ID,
      requestId: "request-revoke-other-sessions",
    }),
    { revokedCount: 2 },
  );
  assert.deepEqual(revoked, [
    {
      userId: USER_ID,
      exceptSessionId: SESSION_ID,
      revokedAt: NOW,
      reason: "other_devices_revoked",
    },
  ]);
  assert.deepEqual(auditRecords, [
    {
      eventType: "session.revoked",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      sessionId: SESSION_ID,
      requestId: "request-revoke-other-sessions",
      metadata: {
        reason: "other_devices_revoked",
        revokedCount: 2,
      },
      occurredAt: NOW,
    },
  ]);
});

test("does not emit an audit record when no other session is active", async () => {
  const auditRecords: SessionSecurityAuditRecord[] = [];
  const useCase = new RevokeOtherSessionsUseCase(
    createSessionRepository(),
    createSecurityAudit(auditRecords),
    { now: () => NOW },
  );

  assert.deepEqual(
    await useCase.execute({
      userId: USER_ID,
      currentSessionId: SESSION_ID,
      requestId: "request-no-other-sessions",
    }),
    { revokedCount: 0 },
  );
  assert.deepEqual(auditRecords, []);
});
