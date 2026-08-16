import assert from "node:assert/strict";
import test from "node:test";

import { RevokeSessionUseCase } from "./revoke-session.js";
import {
  createSessionRepository,
  NOW,
  SESSION_ID,
  USER_ID,
} from "./session-use-case-test-doubles.js";

test("revokes one owned session with the explicit audit reason", async () => {
  const revoked: unknown[] = [];
  const useCase = new RevokeSessionUseCase(
    createSessionRepository({
      async revokeById(input) {
        revoked.push(input);
        return true;
      },
    }),
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
      audit: {
        eventType: "session.revoked",
        actorUserId: USER_ID,
        subjectUserId: USER_ID,
        sessionId: SESSION_ID,
        requestId: "request-revoke-session",
        metadata: { reason: "logout" },
        occurredAt: NOW,
      },
    },
  ]);
});

test("returns false when the owned session is absent", async () => {
  const useCase = new RevokeSessionUseCase(createSessionRepository(), { now: () => NOW });

  assert.deepEqual(
    await useCase.execute({
      sessionId: SESSION_ID,
      userId: USER_ID,
      reason: "user_requested",
      requestId: "request-missing-session",
    }),
    { revoked: false },
  );
});
