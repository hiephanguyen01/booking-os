import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken, parseSessionToken } from "@booking-os/auth";

import { SessionUnavailableError } from "../../domain/session-errors.js";
import type {
  SessionRepositoryPort,
  StoredSessionWithToken,
} from "../ports/session-repository.port.js";
import type { SessionSubjectPort } from "../ports/session-subject.port.js";
import { GetCurrentSessionUseCase } from "./get-current-session.use-case.js";

const NOW = new Date("2026-08-06T04:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";

function storedSession(token: string): StoredSessionWithToken {
  const parsed = parseSessionToken(token);
  if (!parsed) throw new TypeError("Test token must be valid.");
  return {
    session: {
      id: SESSION_ID,
      userId: USER_ID,
      scope: { type: "tenant", tenantId: TENANT_ID },
      hostname: "alpha.example.com",
      state: "active",
      authorizationVersion: 4,
      membershipAuthorizationVersion: 3,
      version: 1,
      idleExpiresAt: new Date("2026-08-13T04:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-09-05T04:00:00.000Z"),
      lastSeenAt: NOW,
      revokedAt: null,
      revocationReason: null,
      compromisedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    token: {
      id: "44444444-4444-4444-8444-444444444444",
      sessionId: SESSION_ID,
      selector: parsed.selector,
      tokenHash: "a".repeat(64),
      issuedAt: NOW,
      expiresAt: new Date("2026-09-05T04:00:00.000Z"),
      replacedAt: null,
      overlapUntil: null,
      successorTokenId: null,
      reuseDetectedAt: null,
      revokedAt: null,
    },
  };
}

function createHarness() {
  const token = createSessionToken();
  const stored = storedSession(token);
  const lookups: unknown[] = [];
  const repository = {
    async findBySelector(input: unknown) {
      lookups.push(input);
      return stored;
    },
  } as unknown as SessionRepositoryPort;
  const subjectVersions: string[] = [];
  const subjects: SessionSubjectPort = {
    async resolveForLogin() {
      return null;
    },
    async currentAuthorizationVersion(userId: string) {
      subjectVersions.push(userId);
      return 9;
    },
    async currentMembershipAuthorizationVersion() {
      return 1;
    },
  };
  const validations: unknown[] = [];
  const validator = {
    async execute(input: unknown) {
      validations.push(input);
      return {
        session: stored.session,
        tokenDisposition: "active" as const,
        rotationRequired: false,
      };
    },
  };
  const useCase = new GetCurrentSessionUseCase(repository, subjects, validator);
  return { useCase, token, stored, lookups, subjectVersions, validations, subjects };
}

test("validates the opaque token against stored snapshots while confirming the user remains active", async () => {
  const harness = createHarness();

  const result = await harness.useCase.execute({
    token: harness.token,
    hostname: "alpha.example.com",
    scope: { type: "tenant", tenantId: TENANT_ID },
    requestId: "request-1",
  });

  const parsed = parseSessionToken(harness.token);
  assert.ok(parsed);
  assert.deepEqual(harness.lookups, [
    {
      selector: parsed.selector,
      hostname: "alpha.example.com",
      scope: { type: "tenant", tenantId: TENANT_ID },
    },
  ]);
  assert.deepEqual(harness.subjectVersions, [USER_ID]);
  assert.deepEqual(harness.validations, [
    {
      token: harness.token,
      hostname: "alpha.example.com",
      scope: { type: "tenant", tenantId: TENANT_ID },
      authorizationVersion: 4,
      requestId: "request-1",
    },
  ]);
  assert.deepEqual(result, {
    actorId: USER_ID,
    sessionId: SESSION_ID,
    authScope: { type: "tenant", tenantId: TENANT_ID },
    sessionState: "active",
    authorizationVersion: 4,
    membershipAuthorizationVersion: 3,
    tokenDisposition: "active",
    rotationRequired: false,
  });
});

test("fails closed when token lookup or current user authorization is unavailable", async () => {
  const missingLookup = createHarness();
  missingLookup.lookups.length = 0;
  const missingRepository = {
    async findBySelector() {
      return null;
    },
  } as unknown as SessionRepositoryPort;
  const missingLookupUseCase = new GetCurrentSessionUseCase(
    missingRepository,
    missingLookup.subjects,
    { execute: async () => assert.fail("validator must not run") },
  );
  await assert.rejects(
    missingLookupUseCase.execute({
      token: missingLookup.token,
      hostname: "alpha.example.com",
      scope: { type: "tenant", tenantId: TENANT_ID },
      requestId: "request-2",
    }),
    (error: unknown) => error instanceof SessionUnavailableError,
  );

  const missingVersion = createHarness();
  missingVersion.subjects.currentAuthorizationVersion = async () => null;
  await assert.rejects(
    missingVersion.useCase.execute({
      token: missingVersion.token,
      hostname: "alpha.example.com",
      scope: { type: "tenant", tenantId: TENANT_ID },
      requestId: "request-3",
    }),
    (error: unknown) => error instanceof SessionUnavailableError,
  );
});
