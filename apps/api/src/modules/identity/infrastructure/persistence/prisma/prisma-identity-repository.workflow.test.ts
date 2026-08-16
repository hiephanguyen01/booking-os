import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaIdentityRepositoryAdapter } from "./prisma-identity-repository.adapter.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-05T09:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-06T09:00:00.000Z");
const TOKEN_HASH = "a".repeat(64);
const PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=1$test$hash";
const HOSTNAME = "console.example.com";

function createTransactionPrisma(transaction: object): PrismaService {
  return {
    async $transaction<T>(callback: (value: object) => Promise<T>): Promise<T> {
      return callback(transaction);
    },
  } as unknown as PrismaService;
}

test("stores the activation password before consuming the token and activating the user", async () => {
  const operations: string[] = [];
  const tokenRow = {
    id: TOKEN_ID,
    userId: USER_ID,
    scopeType: "platform" as const,
    tenantId: null,
    invitationId: null,
    hostname: HOSTNAME,
    selector: "activation-selector",
    tokenHash: TOKEN_HASH,
    expiresAt: EXPIRES_AT,
    consumedAt: null,
    revokedAt: null,
    createdAt: NOW,
  };
  const transaction = {
    async $queryRawUnsafe(): Promise<(typeof tokenRow)[]> {
      operations.push("lock");
      return [tokenRow];
    },
    passwordCredential: {
      async upsert(input: { readonly create: { readonly passwordHash: string } }): Promise<void> {
        operations.push("password");
        assert.equal(input.create.passwordHash, PASSWORD_HASH);
      },
    },
    accountActivationToken: {
      async update(): Promise<void> {
        operations.push("consume");
      },
    },
    user: {
      async update() {
        operations.push("activate");
        return {
          id: USER_ID,
          normalizedEmail: "owner@example.com",
          displayEmail: "Owner@example.com",
          status: "active" as const,
          authorizationVersion: 1,
          activatedAt: NOW,
          suspendedAt: null,
          disabledAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        };
      },
    },
    securityAuditEvent: {
      async create(): Promise<void> {},
    },
  };
  const adapter = new PrismaIdentityRepositoryAdapter(createTransactionPrisma(transaction));

  const user = await adapter.consumeActivationToken({
    selector: tokenRow.selector,
    tokenHash: TOKEN_HASH,
    hostname: HOSTNAME,
    scopeType: "platform",
    tenantId: null,
    passwordHash: PASSWORD_HASH,
    now: NOW,
    requestId: null,
  });

  assert.equal(user.id, USER_ID);
  assert.deepEqual(operations, ["lock", "password", "consume", "activate"]);
});

test("returns the reset subject after replacing the password atomically", async () => {
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
      return [resetRow];
    },
    passwordCredential: { async upsert(): Promise<void> {} },
    passwordResetToken: {
      async update(): Promise<void> {},
      async updateMany(): Promise<{ count: number }> {
        return { count: 0 };
      },
    },
    user: { async update(): Promise<void> {} },
    authSession: {
      async findMany(): Promise<never[]> {
        return [];
      },
      async updateMany(): Promise<{ count: number }> {
        return { count: 0 };
      },
    },
    authSessionToken: {
      async updateMany(): Promise<{ count: number }> {
        return { count: 0 };
      },
    },
    securityAuditEvent: {
      async create(): Promise<void> {},
    },
  };
  const adapter = new PrismaIdentityRepositoryAdapter(createTransactionPrisma(transaction));

  const result = await adapter.replacePasswordAndConsumeReset({
    selector: resetRow.selector,
    tokenHash: TOKEN_HASH,
    hostname: HOSTNAME,
    scopeType: "platform",
    tenantId: null,
    passwordHash: PASSWORD_HASH,
    now: NOW,
    requestId: null,
  });

  assert.deepEqual(result, { userId: USER_ID });
});
