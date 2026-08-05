import assert from "node:assert/strict";
import test from "node:test";
import { IdentityTokenInvalidError } from "../../domain/identity-errors.js";
import type { ConsumeActivationInput } from "../ports/identity-repository.port.js";
import type { SecurityAuditRecord } from "../ports/security-audit.port.js";
import { CompleteActivationUseCase } from "./complete-activation.js";
import {
  createIdentityRepository,
  createOneTimeTokenPort,
  createPasswordDenylist,
  createPasswordHasher,
  createSecurityAudit,
  createUser,
  fixedClock,
  HOSTNAME,
  NOW,
  SERIALIZED_TOKEN,
  TOKEN_HASH,
  USER_ID,
} from "./use-case-test-doubles.js";

const PASSWORD = "Cafe\u0301 secure phrase 2026";
const NORMALIZED_PASSWORD = "Café secure phrase 2026";

test("sets the password and activates the account atomically without creating a session", async () => {
  const purposes: string[] = [];
  const hashed: string[] = [];
  const denylistChecks: string[] = [];
  const consumed: ConsumeActivationInput[] = [];
  const auditRecords: SecurityAuditRecord[] = [];
  const useCase = new CompleteActivationUseCase(
    createIdentityRepository({
      async consumeActivationToken(input) {
        consumed.push(input);
        return createUser({ status: "active", activatedAt: NOW });
      },
    }),
    createOneTimeTokenPort({
      derive(_serialized, purpose) {
        purposes.push(purpose);
        return { selector: "a".repeat(22), tokenHash: TOKEN_HASH };
      },
    }),
    createPasswordHasher({
      async hash(password) {
        hashed.push(password);
        return "$argon2id$v=19$m=65536,t=3,p=1$test$activation";
      },
    }),
    createPasswordDenylist({
      async contains(password) {
        denylistChecks.push(password);
        return false;
      },
    }),
    createSecurityAudit(auditRecords),
    fixedClock,
  );

  const result = await useCase.execute({
    hostname: HOSTNAME,
    token: SERIALIZED_TOKEN,
    newPassword: PASSWORD,
    scopeType: "platform",
    requestId: "request-activation",
  });

  assert.deepEqual(result, { userId: USER_ID });
  assert.deepEqual(purposes, [`identity.activation.v1:platform:-:${HOSTNAME}`]);
  assert.deepEqual(denylistChecks, [NORMALIZED_PASSWORD]);
  assert.deepEqual(hashed, [NORMALIZED_PASSWORD]);
  assert.equal(consumed.length, 1);
  assert.deepEqual(consumed[0], {
    selector: "a".repeat(22),
    tokenHash: TOKEN_HASH,
    hostname: HOSTNAME,
    scopeType: "platform",
    tenantId: null,
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=1$test$activation",
    now: NOW,
  });
  assert.deepEqual(auditRecords, [
    {
      eventType: "identity.activation.completed",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      requestId: "request-activation",
      metadata: { scopeType: "platform", hostname: HOSTNAME },
      occurredAt: NOW,
    },
  ]);
});

test("maps malformed activation material to the generic token error before hashing", async () => {
  let hashed = false;
  const useCase = new CompleteActivationUseCase(
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
    createSecurityAudit([]),
    fixedClock,
  );

  await assert.rejects(
    useCase.execute({
      hostname: HOSTNAME,
      token: "malformed",
      newPassword: NORMALIZED_PASSWORD,
      scopeType: "platform",
      requestId: "request-invalid-activation",
    }),
    (error: unknown) => error instanceof IdentityTokenInvalidError,
  );
  assert.equal(hashed, false);
});
