import assert from "node:assert/strict";
import test from "node:test";

import { RevokeOtherSessionsUseCase } from "./revoke-other-sessions.js";
import {
  createSessionRepository,
  NOW,
  SESSION_ID,
  USER_ID,
} from "./session-use-case-test-doubles.js";

test("revokes every other session with one aggregate audit event", async () => {
  const revoked: unknown[] = [];
  const useCase = new RevokeOtherSessionsUseCase(
    createSessionRepository({
      async revokeOthersForUser(input) {
        revoked.push(input);
        return 2;
      },
    }),
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
      audit: {
        eventType: "session.revoked",
        actorUserId: USER_ID,
        subjectUserId: USER_ID,
        sessionId: SESSION_ID,
        requestId: "request-revoke-other-sessions",
        metadata: { reason: "other_devices_revoked" },
        occurredAt: NOW,
      },
    },
  ]);
});

test("returns zero when no other session is active", async () => {
  const useCase = new RevokeOtherSessionsUseCase(createSessionRepository(), { now: () => NOW });

  assert.deepEqual(
    await useCase.execute({
      userId: USER_ID,
      currentSessionId: SESSION_ID,
      requestId: "request-no-other-sessions",
    }),
    { revokedCount: 0 },
  );
});
