import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaIdentityRepositoryAdapter } from "./prisma-identity-repository.adapter.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-08-11T10:30:00.000Z");
const EXPIRES_AT = new Date("2026-08-11T11:30:00.000Z");
const TOKEN_HASH = "a".repeat(64);
const PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=1$test$hash";
const HOSTNAME = "acme.example.test";
const REQUEST_ID = "request-identity-audit";

const userRow = {
  id: USER_ID,
  normalizedEmail: "owner@example.test",
  displayEmail: "Owner@example.test",
  status: "pending_activation" as const,
  authorizationVersion: 1,
  activatedAt: null,
  suspendedAt: null,
  disabledAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function transactionPrisma(transaction: object, operations: string[]): PrismaService {
  return {
    async $transaction<T>(callback: (client: object) => Promise<T>): Promise<T> {
      operations.push("begin");
      try {
        const result = await callback(transaction);
        operations.push("commit");
        return result;
      } catch (error: unknown) {
        operations.push("rollback");
        throw error;
      }
    },
  } as unknown as PrismaService;
}

test("provisions a pending user and its audit event in one transaction", async () => {
  const operations: string[] = [];
  const transaction = {
    user: {
      async create() {
        operations.push("create_user");
        return userRow;
      },
    },
    securityAuditEvent: {
      async create(input: unknown) {
        operations.push("audit");
        return input;
      },
    },
  };
  const prisma = {
    ...transactionPrisma(transaction, operations),
    user: {
      async create() {
        operations.push("root_create_user");
        return userRow;
      },
    },
  } as unknown as PrismaService;
  const adapter = new PrismaIdentityRepositoryAdapter(prisma);
  const input = {
    normalizedEmail: userRow.normalizedEmail,
    displayEmail: userRow.displayEmail,
    now: NOW,
    requestedByUserId: ACTOR_ID,
    requestId: REQUEST_ID,
    hostname: HOSTNAME,
    scopeType: "tenant" as const,
    tenantId: TENANT_ID,
  };

  await adapter.createPendingUser(input);

  assert.deepEqual(operations, ["begin", "create_user", "audit", "commit"]);
});

test("activation writes bounded audit metadata inside the token-consumption transaction", async () => {
  const operations: string[] = [];
  const tokenRow = {
    id: TOKEN_ID,
    userId: USER_ID,
    scopeType: "tenant" as const,
    tenantId: TENANT_ID,
    invitationId: null,
    hostname: HOSTNAME,
    selector: "activation-selector",
    tokenHash: TOKEN_HASH,
    expiresAt: EXPIRES_AT,
    consumedAt: null,
    revokedAt: null,
    createdAt: NOW,
  };
  const activatedUser = { ...userRow, status: "active" as const, activatedAt: NOW };
  let auditWrite: unknown;
  const transaction = {
    async $queryRawUnsafe(): Promise<(typeof tokenRow)[]> {
      operations.push("lock");
      return [tokenRow];
    },
    passwordCredential: {
      async upsert() {
        operations.push("password");
      },
    },
    accountActivationToken: {
      async update() {
        operations.push("consume");
      },
    },
    user: {
      async update() {
        operations.push("activate");
        return activatedUser;
      },
    },
    securityAuditEvent: {
      async create(input: unknown) {
        operations.push("audit");
        auditWrite = input;
        return input;
      },
    },
  };
  const adapter = new PrismaIdentityRepositoryAdapter(transactionPrisma(transaction, operations));
  const input = {
    selector: tokenRow.selector,
    tokenHash: TOKEN_HASH,
    hostname: HOSTNAME,
    scopeType: "tenant" as const,
    tenantId: TENANT_ID,
    passwordHash: PASSWORD_HASH,
    now: NOW,
    requestId: REQUEST_ID,
  };

  await adapter.consumeActivationToken(input);

  assert.deepEqual(operations, [
    "begin",
    "lock",
    "password",
    "consume",
    "activate",
    "audit",
    "commit",
  ]);
  assert.deepEqual(auditWrite, {
    data: {
      eventType: "identity.activation.completed",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      requestId: REQUEST_ID,
      metadata: {
        action: "activate_user",
        result: "success",
        reason: "activation_token_consumed",
        hostname: HOSTNAME,
        scopeType: "tenant",
        tenantId: TENANT_ID,
      },
      occurredAt: NOW,
    },
  });
});

test("password reset revokes sessions and audits inside the same transaction", async () => {
  const operations: string[] = [];
  const resetRow = {
    id: TOKEN_ID,
    userId: USER_ID,
    scopeType: "tenant" as const,
    tenantId: TENANT_ID,
    hostname: HOSTNAME,
    selector: "reset-selector",
    tokenHash: TOKEN_HASH,
    expiresAt: EXPIRES_AT,
    consumedAt: null,
    revokedAt: null,
    createdAt: NOW,
  };
  let auditWrite: unknown;
  const transaction = {
    async $queryRawUnsafe(): Promise<(typeof resetRow)[]> {
      operations.push("lock");
      return [resetRow];
    },
    passwordCredential: {
      async upsert() {
        operations.push("password");
      },
    },
    passwordResetToken: {
      async update() {
        operations.push("consume");
      },
      async updateMany() {
        operations.push("revoke_other_resets");
        return { count: 1 };
      },
    },
    user: {
      async update() {
        operations.push("version");
      },
    },
    authSession: {
      async findMany() {
        operations.push("find_sessions");
        return [{ id: "session-1" }, { id: "session-2" }];
      },
      async updateMany() {
        operations.push("revoke_sessions");
        return { count: 2 };
      },
    },
    authSessionToken: {
      async updateMany() {
        operations.push("revoke_session_tokens");
        return { count: 2 };
      },
    },
    securityAuditEvent: {
      async create(input: unknown) {
        operations.push("audit");
        auditWrite = input;
        return input;
      },
    },
  };
  const adapter = new PrismaIdentityRepositoryAdapter(transactionPrisma(transaction, operations));
  const input = {
    selector: resetRow.selector,
    tokenHash: TOKEN_HASH,
    hostname: HOSTNAME,
    scopeType: "tenant" as const,
    tenantId: TENANT_ID,
    passwordHash: PASSWORD_HASH,
    now: NOW,
    requestId: REQUEST_ID,
  };

  await adapter.replacePasswordAndConsumeReset(input);

  assert.deepEqual(operations, [
    "begin",
    "lock",
    "password",
    "consume",
    "revoke_other_resets",
    "version",
    "find_sessions",
    "revoke_sessions",
    "revoke_session_tokens",
    "audit",
    "commit",
  ]);
  assert.deepEqual(auditWrite, {
    data: {
      eventType: "identity.password_reset.completed",
      actorUserId: USER_ID,
      subjectUserId: USER_ID,
      requestId: REQUEST_ID,
      metadata: {
        action: "reset_password",
        result: "success",
        reason: "password_reset_token_consumed",
        hostname: HOSTNAME,
        scopeType: "tenant",
        tenantId: TENANT_ID,
        revokedSessionCount: 2,
      },
      occurredAt: NOW,
    },
  });
});

test("audit failure rolls back password reset security-state mutation", async () => {
  const operations: string[] = [];
  const resetRow = {
    id: TOKEN_ID,
    userId: USER_ID,
    scopeType: "platform" as const,
    tenantId: null,
    hostname: HOSTNAME,
    selector: "reset-selector",
    tokenHash: TOKEN_HASH,
    expiresAt: EXPIRES_AT,
    consumedAt: null,
    revokedAt: null,
    createdAt: NOW,
  };
  const transaction = {
    async $queryRawUnsafe(): Promise<(typeof resetRow)[]> {
      operations.push("lock");
      return [resetRow];
    },
    passwordCredential: {
      async upsert() {
        operations.push("password");
      },
    },
    passwordResetToken: {
      async update() {
        operations.push("consume");
      },
      async updateMany() {
        operations.push("revoke_other_resets");
        return { count: 0 };
      },
    },
    user: {
      async update() {
        operations.push("version");
      },
    },
    authSession: {
      async findMany() {
        operations.push("find_sessions");
        return [];
      },
      async updateMany() {
        operations.push("revoke_sessions");
        return { count: 0 };
      },
    },
    authSessionToken: {
      async updateMany() {
        operations.push("revoke_session_tokens");
        return { count: 0 };
      },
    },
    securityAuditEvent: {
      async create() {
        operations.push("audit");
        throw new Error("audit write failed");
      },
    },
  };
  const adapter = new PrismaIdentityRepositoryAdapter(transactionPrisma(transaction, operations));
  const input = {
    selector: resetRow.selector,
    tokenHash: TOKEN_HASH,
    hostname: HOSTNAME,
    scopeType: "platform" as const,
    tenantId: null,
    passwordHash: PASSWORD_HASH,
    now: NOW,
    requestId: REQUEST_ID,
  };

  await assert.rejects(adapter.replacePasswordAndConsumeReset(input), /audit write failed/);
  assert.equal(operations.at(-1), "rollback");
  assert.equal(operations.includes("commit"), false);
});
