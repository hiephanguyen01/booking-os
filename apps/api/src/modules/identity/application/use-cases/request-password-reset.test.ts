import assert from "node:assert/strict";
import test from "node:test";

import type { IssueIdentityEmailInput } from "../ports/identity-outbox.port.js";
import type { SecurityAuditRecord } from "../ports/security-audit.port.js";
import { RequestPasswordResetUseCase } from "./request-password-reset.js";
import {
  HOSTNAME,
  NOW,
  SERIALIZED_TOKEN,
  USER_ID,
  createIdentityOutbox,
  createIdentityRepository,
  createOneTimeTokenPort,
  createSecurityAudit,
  createSensitiveEnvelopePort,
  createUser,
  fixedClock,
} from "./use-case-test-doubles.js";

const TOKEN_ID = "77777777-7777-4777-8777-777777777777";
const EVENT_ID = "88888888-8888-4888-8888-888888888888";

test("returns the same neutral result for missing and existing accounts", async () => {
  let absentIssued = false;
  const absent = new RequestPasswordResetUseCase(
    createIdentityRepository(),
    createIdentityOutbox({
      async issuePasswordReset() {
        absentIssued = true;
      },
    }),
    createOneTimeTokenPort(),
    createSensitiveEnvelopePort(),
    createSecurityAudit([]),
    fixedClock,
  );
  const existing = new RequestPasswordResetUseCase(
    createIdentityRepository({
      async findUserByNormalizedEmail() {
        return createUser({ status: "active", activatedAt: NOW });
      },
    }),
    createIdentityOutbox(),
    createOneTimeTokenPort(),
    createSensitiveEnvelopePort(),
    createSecurityAudit([]),
    fixedClock,
  );

  const absentResult = await absent.execute({
    email: "missing@example.com",
    hostname: HOSTNAME,
    scopeType: "platform",
    requestId: "request-missing",
  });
  const existingResult = await existing.execute({
    email: "owner@example.com",
    hostname: HOSTNAME,
    scopeType: "platform",
    requestId: "request-existing",
  });

  assert.equal(absentResult, undefined);
  assert.equal(existingResult, undefined);
  assert.equal(absentIssued, false);
});

test("commits a single-use encrypted reset event with a 30-minute expiry", async () => {
  const purposes: string[] = [];
  const issued: IssueIdentityEmailInput[] = [];
  const sealed: Array<{ plaintext: string; associatedData: string }> = [];
  const auditRecords: SecurityAuditRecord[] = [];
  const ids = [TOKEN_ID, EVENT_ID];
  const useCase = new RequestPasswordResetUseCase(
    createIdentityRepository({
      async findUserByNormalizedEmail() {
        return createUser({ status: "active", activatedAt: NOW });
      },
    }),
    createIdentityOutbox({
      async issuePasswordReset(input) {
        issued.push(input);
      },
    }),
    createOneTimeTokenPort({
      issue(purpose) {
        purposes.push(purpose);
        return {
          selector: "a".repeat(22),
          serialized: SERIALIZED_TOKEN,
          tokenHash: "c".repeat(64),
        };
      },
    }),
    createSensitiveEnvelopePort((plaintext, associatedData) => {
      sealed.push({
        plaintext: Buffer.from(plaintext).toString("utf8"),
        associatedData: Buffer.from(associatedData).toString("utf8"),
      });
    }),
    createSecurityAudit(auditRecords),
    fixedClock,
    () => ids.shift() ?? assert.fail("unexpected identity ID request"),
  );

  const result = await useCase.execute({
    email: " OWNER@example.com ",
    hostname: HOSTNAME,
    scopeType: "platform",
    requestId: "request-reset",
  });

  assert.equal(result, undefined);
  assert.deepEqual(purposes, [`identity.password_reset.v1:platform:-:${HOSTNAME}`]);
  assert.equal(issued.length, 1);
  const message = issued[0];
  assert.ok(message);
  assert.equal(message.token.id, TOKEN_ID);
  assert.equal(message.token.userId, USER_ID);
  assert.equal(message.token.expiresAt.toISOString(), "2026-08-05T09:30:00.000Z");
  assert.equal(message.event.id, EVENT_ID);
  assert.equal(message.event.type, "identity.password_reset.requested.v1");
  assert.equal(message.event.payload.recipient, "Owner@example.com");
  assert.equal(message.event.payload.template, "password_reset");
  assert.doesNotMatch(JSON.stringify(message.event), new RegExp(SERIALIZED_TOKEN, "u"));
  assert.equal(sealed[0]?.plaintext, JSON.stringify({ token: SERIALIZED_TOKEN }));
  assert.match(sealed[0]?.associatedData ?? "", /identity\.password_reset\.requested\.v1/u);
  assert.deepEqual(auditRecords, [
    {
      eventType: "identity.password_reset.requested",
      actorUserId: null,
      subjectUserId: USER_ID,
      requestId: "request-reset",
      metadata: { scopeType: "platform", hostname: HOSTNAME },
      occurredAt: NOW,
    },
  ]);
});
