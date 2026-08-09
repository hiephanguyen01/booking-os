import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken, deriveSessionSecretDigest, parseSessionToken } from "@booking-os/auth";
import type { Prisma } from "@prisma/client";

import type { SessionElevationPort } from "../modules/memberships/application/ports/session-elevation.port.js";
import type { TenantSessionRevocationPort } from "../modules/sessions/application/ports/session-repository.port.js";
import type { TenantDataSession } from "../modules/tenancy/application/ports/tenant-transaction.port.js";
import { PrismaTenantDataSessionFactory } from "./prisma-tenant-data-session.factory.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000002";
const SESSION_ID = "60000000-0000-4000-8000-000000000001";
const SUCCESSOR_ID = "70000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-08T13:00:00.000Z");
const ABSOLUTE_EXPIRES_AT = new Date("2026-09-07T13:00:00.000Z");
const DIGEST_KEY = new Uint8Array(32).fill(7);
const ROTATED_TOKEN = createSessionToken({
  randomBytes(size) {
    return new Uint8Array(size).fill(size === 18 ? 11 : 13);
  },
});
const PARSED_ROTATED_TOKEN = parseSessionToken(ROTATED_TOKEN);

assert.ok(PARSED_ROTATED_TOKEN);

interface FactoryOptions {
  readonly digestKey: Uint8Array;
  readonly idFactory?: () => string;
  readonly tokenFactory?: () => string;
}

type FactoryConstructor = new (options: FactoryOptions) => PrismaTenantDataSessionFactory;

type Operation = Readonly<{
  kind: "query" | "execute";
  sql: string;
  values: readonly unknown[];
}>;

test("exposes transaction-scoped session elevation that activates and rotates the pending session", async () => {
  const operations: Operation[] = [];
  const transaction = {
    async $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T> {
      operations.push({ kind: "query", sql, values });
      if (sql.includes('FROM "auth_sessions"')) {
        return [
          {
            id: SESSION_ID,
            tenantId: TENANT_ID,
            scopeType: "tenant",
            state: "invitation_pending",
            absoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
            revokedAt: null,
            compromisedAt: null,
          },
        ] as T;
      }
      return [] as T;
    },
    async $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number> {
      operations.push({ kind: "execute", sql, values });
      return 1;
    },
  } as unknown as Prisma.TransactionClient;

  const Factory = PrismaTenantDataSessionFactory as unknown as FactoryConstructor;
  const factory = new Factory({
    digestKey: DIGEST_KEY,
    idFactory: () => SUCCESSOR_ID,
    tokenFactory: () => ROTATED_TOKEN,
  });
  const session = factory.create(transaction, TENANT_ID) as TenantDataSession & {
    readonly sessions?: SessionElevationPort;
  };

  assert.ok(session.sessions, "tenant data session must expose session elevation");

  const result = await session.sessions.elevateInvitationSession({
    sessionId: SESSION_ID,
    now: NOW,
  });

  assert.deepEqual(result, {
    sessionId: SESSION_ID,
    rotatedToken: ROTATED_TOKEN,
  });
  assert.equal(operations.length, 4);
  assert.match(operations[0]?.sql ?? "", /FROM "auth_sessions"/);
  assert.match(operations[0]?.sql ?? "", /FOR UPDATE/);
  assert.deepEqual(operations[0]?.values, [TENANT_ID, SESSION_ID, NOW]);
  assert.match(operations[1]?.sql ?? "", /UPDATE "auth_sessions"/);
  assert.doesNotMatch(operations[1]?.sql ?? "", /"authorization_version"\s*=/);
  assert.deepEqual(operations[1]?.values, [TENANT_ID, SESSION_ID, NOW]);
  assert.match(operations[2]?.sql ?? "", /UPDATE "auth_session_tokens"/);
  assert.deepEqual(operations[2]?.values, [TENANT_ID, SESSION_ID, NOW]);
  assert.match(operations[3]?.sql ?? "", /INSERT INTO "auth_session_tokens"/);
  assert.deepEqual(operations[3]?.values, [
    SUCCESSOR_ID,
    SESSION_ID,
    TENANT_ID,
    PARSED_ROTATED_TOKEN.selector,
    deriveSessionSecretDigest({
      digestKey: DIGEST_KEY,
      secret: PARSED_ROTATED_TOKEN.secret,
    }),
    NOW,
    ABSOLUTE_EXPIRES_AT,
  ]);
});

test("revokes only target-user sessions and tokens inside the transaction tenant", async () => {
  const operations: Operation[] = [];
  const transaction = {
    async $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number> {
      operations.push({ kind: "execute", sql, values });
      return sql.includes('UPDATE "auth_sessions"') ? 2 : 3;
    },
  } as unknown as Prisma.TransactionClient;

  const Factory = PrismaTenantDataSessionFactory as unknown as FactoryConstructor;
  const factory = new Factory({ digestKey: DIGEST_KEY });
  const session = factory.create(transaction, TENANT_ID) as TenantDataSession & {
    readonly sessions?: TenantSessionRevocationPort;
  };

  assert.ok(session.sessions, "tenant data session must expose tenant session revocation");

  const revoked = await session.sessions.revokeTenantSessionsForUser({
    userId: USER_ID,
    revokedAt: NOW,
    reason: "membership_suspended",
  });

  assert.equal(revoked, 2);
  assert.equal(operations.length, 2);
  assert.match(operations[0]?.sql ?? "", /UPDATE "auth_sessions"/);
  assert.match(operations[0]?.sql ?? "", /"tenant_id" = \$1::uuid/);
  assert.match(operations[0]?.sql ?? "", /"user_id" = \$2::uuid/);
  assert.deepEqual(operations[0]?.values, [TENANT_ID, USER_ID, NOW, "membership_suspended"]);
  assert.match(operations[1]?.sql ?? "", /UPDATE "auth_session_tokens"/);
  assert.match(operations[1]?.sql ?? "", /token\."tenant_id" = \$1::uuid/);
  assert.match(operations[1]?.sql ?? "", /session\."user_id" = \$2::uuid/);
  assert.deepEqual(operations[1]?.values, [TENANT_ID, USER_ID, NOW]);
});
