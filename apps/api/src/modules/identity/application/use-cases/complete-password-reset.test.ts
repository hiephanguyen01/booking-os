import assert from "node:assert/strict";
import test from "node:test";
import { IdentityTokenInvalidError } from "../../domain/identity-errors.js";
import type { CompleteResetInput } from "../ports/identity-repository.port.js";
import { CompletePasswordResetUseCase } from "./complete-password-reset.js";
import {
  createIdentityRepository,
  createOneTimeTokenPort,
  createPasswordDenylist,
  createPasswordHasher,
  fixedClock,
  HOSTNAME,
  NOW,
  SERIALIZED_TOKEN,
  TOKEN_HASH,
  USER_ID,
} from "./use-case-test-doubles.js";

const PASSWORD = "Reset secure phrase 2026";

test("replaces the password with atomic session revocation and audit context", async () => {
  const completed: CompleteResetInput[] = [];
  const useCase = new CompletePasswordResetUseCase(
    createIdentityRepository({
      async replacePasswordAndConsumeReset(input) {
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
      requestId: "request-complete-reset",
    },
  ]);
});

test("rejects malformed reset material before hashing or mutating security state", async () => {
  let hashed = false;
  let mutated = false;
  const useCase = new CompletePasswordResetUseCase(
    createIdentityRepository({
      async replacePasswordAndConsumeReset() {
        mutated = true;
        return { userId: USER_ID };
      },
    }),
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
  assert.equal(mutated, false);
});
