import assert from "node:assert/strict";
import test from "node:test";

import { PrismaSessionAuthorizationRefreshAdapter } from "./prisma-session-authorization-refresh.adapter.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "20000000-0000-4000-8000-000000000001";
const TENANT_ID = "30000000-0000-4000-8000-000000000001";

function createHarness() {
  const events: unknown[] = [];
  const transaction = {
    async $executeRawUnsafe(statement: string) {
      events.push(["unsafe", statement]);
      return 0;
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      events.push(["sql", String.raw({ raw: strings.raw }, ...values), values]);
      return 1;
    },
    authSession: {
      async updateMany(input: unknown) {
        events.push(["session", input]);
        return { count: 0 };
      },
    },
    authSessionToken: {
      async updateMany(input: unknown) {
        events.push(["token", input]);
        return { count: 0 };
      },
    },
  };
  const prisma = {
    async $transaction<T>(work: (value: typeof transaction) => Promise<T>) {
      return work(transaction);
    },
  };
  return {
    events,
    adapter: new PrismaSessionAuthorizationRefreshAdapter(
      prisma as never,
      {
        sessionSecret: "test-session-secret-that-is-at-least-32-characters",
      } as never,
    ),
  };
}

test("revokes a platform session only after assuming the platform RLS role", async () => {
  const { adapter, events } = createHarness();

  await adapter.revoke({
    sessionId: SESSION_ID,
    userId: USER_ID,
    scope: { type: "platform" },
    requestId: "request-platform",
    reason: "authorization_subject_inactive",
  });

  assert.deepEqual(events[0], ["unsafe", "SET LOCAL ROLE booking_platform_app"]);
  assert.equal((events[1] as readonly unknown[])[0], "session");
});

test("sets tenant RLS context before revoking a tenant session", async () => {
  const { adapter, events } = createHarness();

  await adapter.revoke({
    sessionId: SESSION_ID,
    userId: USER_ID,
    scope: { type: "tenant", tenantId: TENANT_ID },
    requestId: "request-tenant",
    reason: "authorization_subject_inactive",
  });

  assert.deepEqual(events[0], ["unsafe", "SET LOCAL ROLE booking_app"]);
  assert.deepEqual(events[1], [
    "sql",
    `SELECT set_config('app.tenant_id', ${TENANT_ID}, true)`,
    [TENANT_ID],
  ]);
  assert.equal((events[2] as readonly unknown[])[0], "session");
});
