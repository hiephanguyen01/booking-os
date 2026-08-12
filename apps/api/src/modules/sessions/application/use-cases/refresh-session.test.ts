import assert from "node:assert/strict";
import test from "node:test";

import { deriveSessionSecretDigest, parseSessionToken } from "@booking-os/auth";

import { SessionCompromisedError } from "../../domain/session-errors.js";
import type { SessionSecurityAuditRecord } from "../ports/security-audit.port.js";
import { RefreshSessionUseCase } from "./refresh-session.js";
import {
  createSecurityAudit,
  createSessionRepository,
  DIGEST_KEY,
  HOSTNAME,
  NOW,
  SESSION_ID,
  SUCCESSOR_ID,
  SUCCESSOR_TOKEN,
  storedSession,
  TENANT_ID,
  TOKEN,
  USER_ID,
} from "./session-use-case-test-doubles.js";

function currentSession() {
  const parsed = parseSessionToken(TOKEN);
  assert.notEqual(parsed, null);
  return storedSession({
    token: {
      tokenHash: deriveSessionSecretDigest({
        digestKey: DIGEST_KEY,
        secret: parsed?.secret ?? "",
      }),
    },
  });
}

test("rotates through compare-and-set and records the approved audit event once", async () => {
  const rotations: unknown[] = [];
  const auditRecords: SessionSecurityAuditRecord[] = [];
  const ids = [SUCCESSOR_ID];
  const stored = currentSession();
  const useCase = new RefreshSessionUseCase(
    createSessionRepository({
      async findBySelector() {
        return stored;
      },
      async rotateCompareAndSet(input) {
        rotations.push(input);
        return { status: "rotated", successor: input.successor };
      },
    }),
    createSecurityAudit(auditRecords),
    {
      now: () => NOW,
      digestKey: DIGEST_KEY,
      idFactory: () => ids.shift() ?? "unexpected-id",
      tokenFactory: () => SUCCESSOR_TOKEN,
    },
  );

  const result = await useCase.execute({
    token: TOKEN,
    hostname: HOSTNAME,
    scope: { type: "tenant", tenantId: TENANT_ID },
    authorizationVersion: 4,
    requestId: "request-refresh-session",
  });

  const parsedSuccessor = parseSessionToken(SUCCESSOR_TOKEN);
  assert.deepEqual(result, {
    status: "rotated",
    token: SUCCESSOR_TOKEN,
    session: stored.session,
  });
  assert.equal(rotations.length, 1);
  assert.equal((rotations[0] as { successor: { id: string } }).successor.id, SUCCESSOR_ID);
  assert.equal(
    (rotations[0] as { successor: { selector: string } }).successor.selector,
    parsedSuccessor?.selector,
  );
  assert.match(
    (rotations[0] as { successor: { tokenHash: string } }).successor.tokenHash,
    /^[0-9a-f]{64}$/,
  );
  assert.equal(JSON.stringify(rotations[0]).includes(parsedSuccessor?.secret ?? "missing"), false);
  assert.deepEqual(auditRecords, [
    {
      eventType: "session.rotated",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      sessionId: SESSION_ID,
      requestId: "request-refresh-session",
      metadata: {
        hostname: HOSTNAME,
        scopeType: "tenant",
        tenantId: TENANT_ID,
        result: "success",
      },
      occurredAt: NOW,
    },
  ]);
});

test("a concurrent refresh observes the existing successor without minting another secret", async () => {
  const stored = currentSession();
  const useCase = new RefreshSessionUseCase(
    createSessionRepository({
      async findBySelector() {
        return stored;
      },
      async rotateCompareAndSet() {
        return { status: "existing", successorTokenId: SUCCESSOR_ID };
      },
    }),
    createSecurityAudit([]),
    {
      now: () => NOW,
      digestKey: DIGEST_KEY,
      idFactory: () => SUCCESSOR_ID,
      tokenFactory: () => SUCCESSOR_TOKEN,
    },
  );

  assert.deepEqual(
    await useCase.execute({
      token: TOKEN,
      hostname: HOSTNAME,
      scope: { type: "tenant", tenantId: TENANT_ID },
      authorizationVersion: 4,
      requestId: "request-concurrent-refresh",
    }),
    { status: "overlap", token: null, session: stored.session },
  );
});

test("a compare-and-set reuse result compromises the family and records security audit", async () => {
  const compromised: unknown[] = [];
  const auditRecords: SessionSecurityAuditRecord[] = [];
  const stored = currentSession();
  const useCase = new RefreshSessionUseCase(
    createSessionRepository({
      async findBySelector() {
        return stored;
      },
      async rotateCompareAndSet() {
        return { status: "reuse" };
      },
      async markCompromised(input) {
        compromised.push(input);
      },
    }),
    createSecurityAudit(auditRecords),
    {
      now: () => NOW,
      digestKey: DIGEST_KEY,
      idFactory: () => SUCCESSOR_ID,
      tokenFactory: () => SUCCESSOR_TOKEN,
    },
  );

  await assert.rejects(
    useCase.execute({
      token: TOKEN,
      hostname: HOSTNAME,
      scope: { type: "tenant", tenantId: TENANT_ID },
      authorizationVersion: 4,
      requestId: "request-refresh-reuse",
    }),
    (error: unknown) => error instanceof SessionCompromisedError,
  );
  assert.deepEqual(compromised, [
    {
      sessionId: SESSION_ID,
      tokenId: stored.token.id,
      compromisedAt: NOW,
      reason: "token_reuse",
    },
  ]);
  assert.equal(auditRecords[0]?.eventType, "session.compromised");
  assert.equal(auditRecords[0]?.actorUserId, USER_ID);
});
