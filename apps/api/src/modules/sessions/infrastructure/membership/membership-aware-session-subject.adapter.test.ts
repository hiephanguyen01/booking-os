import assert from "node:assert/strict";
import test from "node:test";

import type {
  LoginSessionSubject,
  ResolveLoginSubjectInput,
  SessionSubjectPort,
} from "../../application/ports/session-subject.port.js";
import { MembershipAwareSessionSubjectAdapter } from "./membership-aware-session-subject.adapter.js";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

class FakeActiveSubjects implements SessionSubjectPort {
  subject: LoginSessionSubject | null = null;
  authorizationVersion: number | null = 7;
  readonly resolveCalls: ResolveLoginSubjectInput[] = [];
  readonly versionCalls: string[] = [];

  async resolveForLogin(input: ResolveLoginSubjectInput): Promise<LoginSessionSubject | null> {
    this.resolveCalls.push(input);
    return this.subject;
  }

  async currentAuthorizationVersion(userId: string): Promise<number | null> {
    this.versionCalls.push(userId);
    return this.authorizationVersion;
  }
}

class FakePendingInvitationLogin {
  eligible = false;
  readonly calls: unknown[] = [];

  async execute(input: unknown): Promise<boolean> {
    this.calls.push(input);
    return this.eligible;
  }
}

function createHarness() {
  const active = new FakeActiveSubjects();
  const pending = new FakePendingInvitationLogin();
  const adapter = new MembershipAwareSessionSubjectAdapter(active, pending);
  return { active, pending, adapter };
}

test("keeps an active tenant subject and does not inspect pending invitations", async () => {
  const harness = createHarness();
  harness.active.subject = { state: "active", authorizationVersion: 4 };

  const result = await harness.adapter.resolveForLogin({
    userId: USER_ID,
    hostname: "acme.booking.test",
    scope: { type: "tenant", tenantId: TENANT_ID },
  });

  assert.deepEqual(result, { state: "active", authorizationVersion: 4 });
  assert.equal(harness.pending.calls.length, 0);
});

test("creates an invitation-pending subject for a tenant with no active subject and a valid invitation", async () => {
  const harness = createHarness();
  harness.pending.eligible = true;

  const result = await harness.adapter.resolveForLogin({
    userId: USER_ID,
    hostname: "acme.booking.test",
    scope: { type: "tenant", tenantId: TENANT_ID },
  });

  assert.deepEqual(result, { state: "invitation_pending", authorizationVersion: 7 });
  assert.deepEqual(harness.pending.calls, [
    { tenantId: TENANT_ID, userId: USER_ID, hostname: "acme.booking.test" },
  ]);
  assert.deepEqual(harness.active.versionCalls, [USER_ID]);
});

test("fails closed when a valid pending invitation has no current user authorization version", async () => {
  const harness = createHarness();
  harness.pending.eligible = true;
  harness.active.authorizationVersion = null;

  const result = await harness.adapter.resolveForLogin({
    userId: USER_ID,
    hostname: "acme.booking.test",
    scope: { type: "tenant", tenantId: TENANT_ID },
  });

  assert.equal(result, null);
  assert.deepEqual(harness.active.versionCalls, [USER_ID]);
});

for (const authorizationVersion of [0, -1, 1.5]) {
  test(`fails closed when a valid pending invitation has invalid authorization version ${authorizationVersion}`, async () => {
    const harness = createHarness();
    harness.pending.eligible = true;
    harness.active.authorizationVersion = authorizationVersion;

    const result = await harness.adapter.resolveForLogin({
      userId: USER_ID,
      hostname: "acme.booking.test",
      scope: { type: "tenant", tenantId: TENANT_ID },
    });

    assert.equal(result, null);
    assert.deepEqual(harness.active.versionCalls, [USER_ID]);
  });
}

test("returns null when a tenant has neither an active subject nor a valid pending invitation", async () => {
  const harness = createHarness();

  const result = await harness.adapter.resolveForLogin({
    userId: USER_ID,
    hostname: "acme.booking.test",
    scope: { type: "tenant", tenantId: TENANT_ID },
  });

  assert.equal(result, null);
});

test("never uses tenant invitation eligibility for platform login", async () => {
  const harness = createHarness();
  harness.pending.eligible = true;

  const result = await harness.adapter.resolveForLogin({
    userId: USER_ID,
    hostname: "platform.example.test",
    scope: { type: "platform" },
  });

  assert.equal(result, null);
  assert.equal(harness.pending.calls.length, 0);
});

test("delegates current authorization version checks to the active subject adapter", async () => {
  const harness = createHarness();

  const result = await harness.adapter.currentAuthorizationVersion(USER_ID);

  assert.equal(result, 7);
  assert.deepEqual(harness.active.versionCalls, [USER_ID]);
});
