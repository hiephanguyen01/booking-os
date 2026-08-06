import assert from "node:assert/strict";
import test from "node:test";

import { ListSessionsUseCase } from "./list-sessions.js";
import {
  createSessionRepository,
  SESSION_ID,
  storedSession,
  TENANT_ID,
  USER_ID,
} from "./session-use-case-test-doubles.js";

const OTHER_SESSION_ID = "66666666-6666-4666-8666-666666666666";

test("lists only public session summaries and marks the current device", async () => {
  const calls: unknown[] = [];
  const current = storedSession().session;
  const other = storedSession({
    session: {
      id: OTHER_SESSION_ID,
      hostname: "mobile.example.test",
      lastSeenAt: new Date("2026-08-05T23:45:00.000Z"),
      createdAt: new Date("2026-08-05T20:00:00.000Z"),
    },
  }).session;
  const useCase = new ListSessionsUseCase(
    createSessionRepository({
      async listForUser(input) {
        calls.push(input);
        return [other, current];
      },
    }),
  );

  assert.deepEqual(
    await useCase.execute({ userId: USER_ID, currentSessionId: SESSION_ID }),
    [
      {
        id: OTHER_SESSION_ID,
        scope: { type: "tenant", tenantId: TENANT_ID },
        hostname: "mobile.example.test",
        state: "active",
        current: false,
        createdAt: new Date("2026-08-05T20:00:00.000Z"),
        lastSeenAt: new Date("2026-08-05T23:45:00.000Z"),
        idleExpiresAt: new Date("2026-08-13T02:00:00.000Z"),
        absoluteExpiresAt: new Date("2026-09-05T02:00:00.000Z"),
      },
      {
        id: SESSION_ID,
        scope: { type: "tenant", tenantId: TENANT_ID },
        hostname: "console.example.test",
        state: "active",
        current: true,
        createdAt: new Date("2026-08-06T01:30:00.000Z"),
        lastSeenAt: new Date("2026-08-06T01:50:00.000Z"),
        idleExpiresAt: new Date("2026-08-13T02:00:00.000Z"),
        absoluteExpiresAt: new Date("2026-09-05T02:00:00.000Z"),
      },
    ],
  );
  assert.deepEqual(calls, [{ userId: USER_ID }]);
});
