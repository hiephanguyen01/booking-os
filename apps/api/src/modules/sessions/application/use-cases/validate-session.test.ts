import assert from "node:assert/strict";
import test from "node:test";

import { deriveSessionSecretDigest, parseSessionToken } from "@booking-os/auth";

import {
  SessionAuthorizationStaleError,
  SessionCompromisedError,
  SessionUnavailableError,
} from "../../domain/session-errors.js";
import type { SessionSecurityAuditRecord } from "../ports/security-audit.port.js";
import { ValidateSessionUseCase } from "./validate-session.js";
import {
  createSecurityAudit,
  createSessionRepository,
  DIGEST_KEY,
  HOSTNAME,
  NOW,
  SESSION_ID,
  storedSession,
  TENANT_ID,
  TOKEN,
  USER_ID,
} from "./session-use-case-test-doubles.js";

function validStoredSession() {
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

test("validates exact host, scope, state, expiry, and authorization snapshot", async () => {
  const lookups: unknown[] = [];
  const touches: unknown[] = [];
  const stored = validStoredSession();
  const useCase = new ValidateSessionUseCase(
    createSessionRepository({
      async findBySelector(input) {
        lookups.push(input);
        return stored;
      },
      async touchIfDue(input) {
        touches.push(input);
      },
    }),
    createSecurityAudit([]),
    { now: () => NOW, digestKey: DIGEST_KEY },
  );

  const result = await useCase.execute({
    token: TOKEN,
    hostname: HOSTNAME,
    scope: { type: "tenant", tenantId: TENANT_ID },
    authorizationVersion: 4,
    requestId: "request-validate-session",
  });

  assert.equal(result.session.id, SESSION_ID);
  assert.equal(result.tokenDisposition, "active");
  assert.equal(result.rotationRequired, true);
  assert.deepEqual(lookups, [
    {
      selector: parseSessionToken(TOKEN)?.selector,
      hostname: HOSTNAME,
      scope: { type: "tenant", tenantId: TENANT_ID },
    },
  ]);
  assert.deepEqual(touches, [
    {
      sessionId: SESSION_ID,
      expectedVersion: 1,
      lastSeenAt: NOW,
      idleExpiresAt: new Date("2026-08-13T02:00:00.000Z"),
    },
  ]);
});

test("rejects host, scope, state, and expiry mismatches without touching", async () => {
  const invalidRows = [
    validStoredSession(),
    storedSession({ session: { scope: { type: "platform" } } }),
    storedSession({ session: { state: "revoked", revokedAt: NOW } }),
    storedSession({ session: { idleExpiresAt: NOW } }),
  ];

  for (const [index, row] of invalidRows.entries()) {
    let touched = false;
    const useCase = new ValidateSessionUseCase(
      createSessionRepository({
        async findBySelector() {
          return index === 0
            ? storedSession({ session: { hostname: "other.example.test" }, token: row.token })
            : row;
        },
        async touchIfDue() {
          touched = true;
        },
      }),
      createSecurityAudit([]),
      { now: () => NOW, digestKey: DIGEST_KEY },
    );

    await assert.rejects(
      useCase.execute({
        token: TOKEN,
        hostname: HOSTNAME,
        scope: { type: "tenant", tenantId: TENANT_ID },
        authorizationVersion: 4,
        requestId: `request-invalid-${String(index)}`,
      }),
      (error: unknown) => error instanceof SessionUnavailableError,
    );
    assert.equal(touched, false);
  }
});

test("rejects stale authorization snapshots", async () => {
  const useCase = new ValidateSessionUseCase(
    createSessionRepository({
      async findBySelector() {
        return validStoredSession();
      },
    }),
    createSecurityAudit([]),
    { now: () => NOW, digestKey: DIGEST_KEY },
  );

  await assert.rejects(
    useCase.execute({
      token: TOKEN,
      hostname: HOSTNAME,
      scope: { type: "tenant", tenantId: TENANT_ID },
      authorizationVersion: 5,
      requestId: "request-stale-version",
    }),
    (error: unknown) => error instanceof SessionAuthorizationStaleError,
  );
});

test("post-overlap token reuse compromises and revokes the whole family", async () => {
  const compromised: unknown[] = [];
  const auditRecords: SessionSecurityAuditRecord[] = [];
  const stored = validStoredSession();
  const useCase = new ValidateSessionUseCase(
    createSessionRepository({
      async findBySelector() {
        return {
          session: stored.session,
          token: {
            ...stored.token,
            replacedAt: new Date("2026-08-06T01:58:00.000Z"),
            overlapUntil: new Date("2026-08-06T01:58:30.000Z"),
            successorTokenId: "55555555-5555-4555-8555-555555555555",
          },
        };
      },
      async markCompromised(input) {
        compromised.push(input);
      },
    }),
    createSecurityAudit(auditRecords),
    { now: () => NOW, digestKey: DIGEST_KEY },
  );

  await assert.rejects(
    useCase.execute({
      token: TOKEN,
      hostname: HOSTNAME,
      scope: { type: "tenant", tenantId: TENANT_ID },
      authorizationVersion: 4,
      requestId: "request-reused-token",
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
  assert.deepEqual(auditRecords, [
    {
      eventType: "session.compromised",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      sessionId: SESSION_ID,
      requestId: "request-reused-token",
      metadata: { reason: "token_reuse", hostname: HOSTNAME },
      occurredAt: NOW,
    },
  ]);
});
