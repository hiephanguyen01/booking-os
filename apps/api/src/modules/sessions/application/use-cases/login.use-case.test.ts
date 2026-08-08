import assert from "node:assert/strict";
import test from "node:test";

import type {
  CredentialVerifierPort,
  VerifiedCredential,
} from "../ports/credential-verifier.port.js";
import type { LoginAbuseProtectionPort } from "../ports/login-abuse-protection.port.js";
import type { StoredSession } from "../ports/session-repository.port.js";
import type { LoginSessionSubject, SessionSubjectPort } from "../ports/session-subject.port.js";
import { InvalidLoginError, LoginUseCase } from "./login.use-case.js";

const HMAC_KEY = new Uint8Array(32).fill(7);
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-06T05:00:00.000Z");

const ISSUED_SESSION: StoredSession = Object.freeze({
  id: "33333333-3333-4333-8333-333333333333",
  userId: USER_ID,
  scope: { type: "platform" as const },
  hostname: "console.example.com",
  state: "active",
  authorizationVersion: 3,
  version: 1,
  idleExpiresAt: new Date("2026-08-13T05:00:00.000Z"),
  absoluteExpiresAt: new Date("2026-09-05T05:00:00.000Z"),
  lastSeenAt: NOW,
  revokedAt: null,
  revocationReason: null,
  compromisedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});

class FakeCredentials implements CredentialVerifierPort {
  verification: VerifiedCredential | null = {
    userId: USER_ID,
    status: "active",
    passwordNeedsRehash: false,
  };
  readonly verifyCalls: unknown[] = [];
  readonly rehashCalls: unknown[] = [];

  async verify(input: unknown): Promise<VerifiedCredential | null> {
    this.verifyCalls.push(input);
    return this.verification;
  }

  async rehashPassword(input: unknown): Promise<void> {
    this.rehashCalls.push(input);
  }
}

class FakeSubjects implements SessionSubjectPort {
  subject: LoginSessionSubject | null = {
    authorizationVersion: 3,
    state: "active",
  };
  readonly resolveCalls: unknown[] = [];

  async resolveForLogin(input: unknown): Promise<LoginSessionSubject | null> {
    this.resolveCalls.push(input);
    return this.subject;
  }

  async currentAuthorizationVersion(): Promise<number | null> {
    return this.subject?.authorizationVersion ?? null;
  }
}

class FakeAbuseProtection implements LoginAbuseProtectionPort {
  delayMs = 0;
  readonly calls: string[] = [];

  async beforeAttempt(): Promise<{ readonly delayMs: number }> {
    this.calls.push("before");
    return { delayMs: this.delayMs };
  }

  async recordFailure(): Promise<void> {
    this.calls.push("failure");
  }

  async recordSuccess(): Promise<void> {
    this.calls.push("success");
  }
}

function createHarness() {
  const credentials = new FakeCredentials();
  const subjects = new FakeSubjects();
  const abuse = new FakeAbuseProtection();
  const issued: unknown[] = [];
  const sleeps: number[] = [];
  const sessions = {
    async execute(input: unknown) {
      issued.push(input);
      return { token: "selector.secret", session: ISSUED_SESSION };
    },
  };
  const useCase = new LoginUseCase(credentials, subjects, abuse, sessions, {
    abuseHmacKey: HMAC_KEY,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
    },
  });
  return { useCase, credentials, subjects, abuse, issued, sleeps };
}

test("creates a platform session from a trusted hostname and assignment", async () => {
  const harness = createHarness();

  const result = await harness.useCase.execute({
    email: "  Admin@Example.com ",
    password: "correct horse battery staple",
    ipAddress: "203.0.113.44",
    hostname: "console.example.com",
    scope: { type: "platform" },
    requestId: "request-1",
  });

  assert.equal(result.token, "selector.secret");
  assert.deepEqual(harness.credentials.verifyCalls, [
    {
      normalizedEmail: "admin@example.com",
      password: "correct horse battery staple",
    },
  ]);
  assert.deepEqual(harness.subjects.resolveCalls, [
    { userId: USER_ID, hostname: "console.example.com", scope: { type: "platform" } },
  ]);
  assert.deepEqual(harness.abuse.calls, ["before", "success"]);
  assert.deepEqual(harness.issued, [
    {
      userId: USER_ID,
      scope: { type: "platform" },
      hostname: "console.example.com",
      state: "active",
      authorizationVersion: 3,
      requestId: "request-1",
    },
  ]);
});

test("uses the tenant subject hook without accepting tenant authority from credentials", async () => {
  const harness = createHarness();
  harness.subjects.subject = {
    authorizationVersion: 5,
    state: "invitation_pending",
  };

  await harness.useCase.execute({
    email: "owner@example.com",
    password: "secret",
    ipAddress: "2001:db8:abcd:1234::1",
    hostname: "alpha.example.com",
    scope: { type: "tenant", tenantId: TENANT_ID },
    requestId: "request-2",
  });

  assert.deepEqual(harness.subjects.resolveCalls, [
    {
      userId: USER_ID,
      hostname: "alpha.example.com",
      scope: { type: "tenant", tenantId: TENANT_ID },
    },
  ]);
  assert.deepEqual(harness.issued, [
    {
      userId: USER_ID,
      scope: { type: "tenant", tenantId: TENANT_ID },
      hostname: "alpha.example.com",
      state: "invitation_pending",
      authorizationVersion: 5,
      requestId: "request-2",
    },
  ]);
});

test("applies progressive delay and rehashes Argon2 after successful verification", async () => {
  const harness = createHarness();
  harness.abuse.delayMs = 1_500;
  harness.credentials.verification = {
    userId: USER_ID,
    status: "active",
    passwordNeedsRehash: true,
  };

  await harness.useCase.execute({
    email: "admin@example.com",
    password: "secret",
    ipAddress: "203.0.113.44",
    hostname: "console.example.com",
    scope: { type: "platform" },
    requestId: "request-3",
  });

  assert.deepEqual(harness.sleeps, [1_500]);
  assert.deepEqual(harness.credentials.rehashCalls, [{ userId: USER_ID, password: "secret" }]);
  assert.deepEqual(harness.abuse.calls, ["before", "success"]);
});

test("uses one generic error for unknown, invalid, inactive, or unassigned accounts", async () => {
  for (const configure of [
    (harness: ReturnType<typeof createHarness>) => {
      harness.credentials.verification = null;
    },
    (harness: ReturnType<typeof createHarness>) => {
      harness.credentials.verification = {
        userId: USER_ID,
        status: "suspended",
        passwordNeedsRehash: false,
      };
    },
    (harness: ReturnType<typeof createHarness>) => {
      harness.subjects.subject = null;
    },
  ]) {
    const harness = createHarness();
    configure(harness);

    await assert.rejects(
      harness.useCase.execute({
        email: "admin@example.com",
        password: "wrong",
        ipAddress: "203.0.113.44",
        hostname: "console.example.com",
        scope: { type: "platform" },
        requestId: "request-invalid",
      }),
      (error: unknown) => error instanceof InvalidLoginError,
    );
    assert.deepEqual(harness.abuse.calls, ["before", "failure"]);
    assert.equal(harness.issued.length, 0);
  }
});
