import assert from "node:assert/strict";
import test from "node:test";

import { parseSessionToken } from "@booking-os/auth";
import type { CreateSessionRecord } from "../ports/session-repository.port.js";
import { CreateSessionUseCase } from "./create-session.js";
import {
  createSessionRepository,
  DIGEST_KEY,
  HOSTNAME,
  NOW,
  SESSION_ID,
  TENANT_ID,
  TOKEN,
  TOKEN_ID,
  USER_ID,
} from "./session-use-case-test-doubles.js";

test("creates a host-bound tenant session while persisting only the token digest", async () => {
  const created: CreateSessionRecord[] = [];
  const ids = [SESSION_ID, TOKEN_ID];
  const useCase = new CreateSessionUseCase(createSessionRepository({
    async create(input) {
      created.push(input);
      return input;
    },
  }), {
    now: () => NOW,
    digestKey: DIGEST_KEY,
    idFactory: () => ids.shift() ?? "unexpected-id",
    tokenFactory: () => TOKEN,
  });

  const result = await useCase.execute({
    userId: USER_ID,
    scope: { type: "tenant", tenantId: TENANT_ID },
    hostname: HOSTNAME,
    state: "active",
    authorizationVersion: 4,
    membershipAuthorizationVersion: 6,
    requestId: "request-create-session",
  });

  const parsed = parseSessionToken(TOKEN);
  assert.notEqual(parsed, null);
  assert.equal(result.token, TOKEN);
  assert.equal(result.session.id, SESSION_ID);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.session.hostname, HOSTNAME);
  assert.deepEqual(created[0]?.session.scope, { type: "tenant", tenantId: TENANT_ID });
  assert.equal(created[0]?.session.membershipAuthorizationVersion, 6);
  assert.equal(created[0]?.session.idleExpiresAt.toISOString(), "2026-08-13T02:00:00.000Z");
  assert.equal(created[0]?.session.absoluteExpiresAt.toISOString(), "2026-09-05T02:00:00.000Z");
  assert.equal(created[0]?.token.selector, parsed?.selector);
  assert.match(created[0]?.token.tokenHash ?? "", /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(created[0]).includes(parsed?.secret ?? "missing"), false);
  assert.deepEqual(created[0]?.audit, {
    eventType: "session.created",
    actorUserId: USER_ID,
    subjectUserId: USER_ID,
    sessionId: SESSION_ID,
    requestId: "request-create-session",
    metadata: {
      hostname: HOSTNAME,
      scopeType: "tenant",
      tenantId: TENANT_ID,
      state: "active",
    },
    occurredAt: NOW,
  });
});
