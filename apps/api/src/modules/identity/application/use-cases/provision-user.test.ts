import assert from "node:assert/strict";
import test from "node:test";

import type { IssueIdentityEmailInput } from "../ports/identity-outbox.port.js";
import { ProvisionUserUseCase } from "./provision-user.js";
import {
  createIdentityOutbox,
  createIdentityRepository,
  createOneTimeTokenPort,
  createSensitiveEnvelopePort,
  createUser,
  fixedClock,
  HOSTNAME,
  NOW,
  REQUESTED_BY_USER_ID,
  SERIALIZED_TOKEN,
  USER_ID,
} from "./use-case-test-doubles.js";

const TOKEN_ID = "55555555-5555-4555-8555-555555555555";
const EVENT_ID = "66666666-6666-4666-8666-666666666666";

test("creates a pending global user and commits a 24-hour encrypted activation event", async () => {
  const createdUsers: unknown[] = [];
  const purposes: string[] = [];
  const issued: IssueIdentityEmailInput[] = [];
  const sealed: Array<{ plaintext: string; associatedData: string }> = [];
  const ids = [TOKEN_ID, EVENT_ID];
  const useCase = new ProvisionUserUseCase(
    createIdentityRepository({
      async createPendingUser(input) {
        createdUsers.push(input);
        return createUser({
          normalizedEmail: input.normalizedEmail,
          displayEmail: input.displayEmail,
          createdAt: input.now,
          updatedAt: input.now,
        });
      },
    }),
    createIdentityOutbox({
      async issueActivation(input) {
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
    fixedClock,
    () => ids.shift() ?? assert.fail("unexpected identity ID request"),
  );

  const result = await useCase.execute({
    email: "  Owner@Example.com  ",
    hostname: HOSTNAME,
    scopeType: "platform",
    requestedByUserId: REQUESTED_BY_USER_ID,
    requestId: "request-provision",
  });

  assert.deepEqual(result, { userId: USER_ID });
  assert.deepEqual(createdUsers, [
    {
      normalizedEmail: "owner@example.com",
      displayEmail: "Owner@Example.com",
      now: NOW,
      requestedByUserId: REQUESTED_BY_USER_ID,
      requestId: "request-provision",
      hostname: HOSTNAME,
      scopeType: "platform",
      tenantId: null,
    },
  ]);
  assert.deepEqual(purposes, [`identity.activation.v1:platform:-:${HOSTNAME}`]);
  assert.equal(issued.length, 1);
  const message = issued[0];
  assert.ok(message);
  assert.equal(message.token.id, TOKEN_ID);
  assert.equal(message.token.userId, USER_ID);
  assert.equal(message.token.expiresAt.toISOString(), "2026-08-06T09:00:00.000Z");
  assert.equal(message.event.id, EVENT_ID);
  assert.equal(message.event.type, "identity.activation.requested.v1");
  assert.equal(message.event.payload.recipient, "Owner@Example.com");
  assert.equal(message.event.payload.template, "account_activation");
  assert.equal(message.event.payload.hostname, HOSTNAME);
  assert.doesNotMatch(JSON.stringify(message.event), new RegExp(SERIALIZED_TOKEN, "u"));
  assert.equal(sealed.length, 1);
  assert.equal(sealed[0]?.plaintext, JSON.stringify({ token: SERIALIZED_TOKEN }));
  assert.match(sealed[0]?.associatedData ?? "", /identity\.activation\.requested\.v1/u);
  assert.match(sealed[0]?.associatedData ?? "", new RegExp(EVENT_ID, "u"));
  assert.match(sealed[0]?.associatedData ?? "", new RegExp(HOSTNAME, "u"));
});

test("returns the same result shape for an existing active user without issuing activation", async () => {
  let created = false;
  let issued = false;
  const useCase = new ProvisionUserUseCase(
    createIdentityRepository({
      async findUserByNormalizedEmail() {
        return createUser({ status: "active", activatedAt: NOW });
      },
      async createPendingUser() {
        created = true;
        return createUser();
      },
    }),
    createIdentityOutbox({
      async issueActivation() {
        issued = true;
      },
    }),
    createOneTimeTokenPort(),
    createSensitiveEnvelopePort(),
    fixedClock,
  );

  const result = await useCase.execute({
    email: "owner@example.com",
    hostname: HOSTNAME,
    scopeType: "platform",
    requestedByUserId: REQUESTED_BY_USER_ID,
    requestId: "request-existing",
  });

  assert.deepEqual(result, { userId: USER_ID });
  assert.equal(created, false);
  assert.equal(issued, false);
});
