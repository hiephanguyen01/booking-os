import assert from "node:assert/strict";
import test from "node:test";

import type { CompleteResetInput } from "../ports/identity-repository.port.js";
import type { SecurityAuditRecord } from "../ports/security-audit.port.js";
import type { SessionRevocationPort } from "../ports/session-revocation.port.js";
import { IdentityTokenInvalidError } from "../../domain/identity-errors.js";
import { CompletePasswordResetUseCase } from "./complete-password-reset.js";
import {
  HOSTNAME,
  NOW,
  SERIALIZED_TOKEN,
  TOKEN_HASH,
  USER_ID,
  createIdentityRepository,
  createOneTimeTokenPort,
  createPasswordDenylist,
  createPasswordHasher,
  createSecurityAudit,
  createSessionRevocation,
  fixedClock,
} from "./use-case-test-doubles.js";

const PASSWORD = "Reset secure phrase 2026";

test("replaces the password, revokes every session, and records one security event", async () => {
  const operations: string[] = [];
  const completed: CompleteResetInput[] = [];
  const revoked: Array<{ readonly userId: string; readonly revokedAt: Date }> = [];
  const auditRecords: SecurityAuditRecord[] = [];
  const sessionRevocation: SessionRevocationPort = {
    async revokeAllForUser(userId, revokedAt) {
      operations.push("revoke-sessions");
      revoked.push({ userId, revokedAt });
    },
  };
  const useCase = new CompletePasswordResetUseCase(
    createIdentityRepository({
      async replacePasswordAndConsumeReset(input) {
        operations.push("replace-password");
        completed.push(input);
        return { userId: USER_ID };
      },
    }),
    createOneTimeTokenPort({
      derive(_serialized, purpose) {
        assert.equal(purpose, `identity.password_reset.v1:platform:-:${HOSTNAME}`);
        return { selector: "a".repeat(22), tokenHash: TOKEN_HASH };
      },
    }),
    createPasswordHasher({
      async hash(password) {
        assert.equal(password, PASSWORD);
        return "$argon2id$v=19$m=65536,t=3,p=1$test$reset";
      },
    }),
    createPasswordDenylist(),
    sessionRevocation,
    createSecurityAudit(auditRecords, {
      async record(record) {
        operations.push("audit");
        auditRecords.push(record);
      },
    }),
    fixedClock,
  );

  const result = await useCase.execute({
    hostname: HOSTNAME,
    token: SERIALIZED_TOKEN,
    newPassword: PASSWORD,
    scopeType: "platform",
    requestId: "request-complete-reset",
  });

  assert.deepEqual(result, { userId: USER_ID });
  assert.deepEqual(completed, [
    {
      selector: "a".repeat(22),
      tokenHash: TOKEN_HASH,
      hostname: HOSTNAME,
      scopeType: "platform",
      tenantId: null,
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=1$test$reset",
      now: NOW,
    },
  ]);
  assert.deepEqual(revoked, [{ userId: USER_ID, revokedAt: NOW }]);
  assert.deepEqual(operations, ["replace-password", "revoke-sessions", "audit"]);
  assert.deepEqual(auditRecords, [
    {
      eventType: "identity.password_reset.completed",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      requestId: "request-complete-reset",
      metadata: { scopeType: "platform", hostname: HOSTNAME },
      occurredAt: NOW,
    },
  ]);
});

test("rejects malformed reset material before hashing or revoking sessions", async () => {
  let hashed = false;
  const revoked: Array<{ readonly userId: string; readonly revokedAt: Date }> = [];
  const useCase = new CompletePasswordResetUseCase(
    createIdentityRepository(),
    createOneTimeTokenPort({
      derive() {
        return null;
      },
    }),
    createPasswordHasher({
      async hash() {
        hashed = true;
        return "unexpected";
      },
    }),
    createPasswordDenylist(),
    createSessionRevocation(revoked),
    createSecurityAudit([]),
    fixedClock,
  );

  await assert.rejects(
    useCase.execute({
      hostname: HOSTNAME,
      token: "malformed",
      newPassword: PASSWORD,
      scopeType: "platform",
      requestId: "request-invalid-reset",
    }),
    (error: unknown) => error instanceof IdentityTokenInvalidError,
  );
  assert.equal(hashed, false);
  assert.deepEqual(revoked, []);
});
