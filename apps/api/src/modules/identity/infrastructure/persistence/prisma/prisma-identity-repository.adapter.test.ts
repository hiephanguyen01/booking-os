import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import {
  IdentityEmailConflictError,
  IdentityTokenInvalidError,
} from "../../../domain/identity-errors.js";
import { PrismaIdentityRepositoryAdapter } from "./prisma-identity-repository.adapter.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-05T08:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-06T08:00:00.000Z");
const TOKEN_HASH = "a".repeat(64);
const PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=1$test$hash";
const HOSTNAME = "console.example.com";

const userRow = {
  id: USER_ID,
  normalizedEmail: "admin@example.com",
  displayEmail: "Admin@example.com",
  status: "pending_activation" as const,
  authorizationVersion: 1,
  activatedAt: null,
  suspendedAt: null,
  disabledAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function createTransactionPrisma(transaction: object): PrismaService {
  return {
    async $transaction<T>(callback: (value: object) => Promise<T>): Promise<T> {
      return callback(transaction);
    },
  } as unknown as PrismaService;
}

test("maps concurrent normalized-email collisions to a stable domain error", async () => {
  let created = false;
  const prisma = {
    user: {
      async create(): Promise<typeof userRow> {
        await Promise.resolve();
        if (created) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
            meta: { target: ["normalized_email"] },
          });
        }
        created = true;
        return userRow;
      },
    },
  } as unknown as PrismaService;
  const adapter = new PrismaIdentityRepositoryAdapter(prisma);
  const input = {
    normalizedEmail: userRow.normalizedEmail,
    displayEmail: userRow.displayEmail,
    now: NOW,
  };

  const results = await Promise.allSettled([
    adapter.createPendingUser(input),
    adapter.createPendingUser(input),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status !== "rejected") {
    assert.fail("expected one concurrent create to be rejected");
  }
  const reason: unknown = rejected.reason;
  if (!(reason instanceof IdentityEmailConflictError)) {
    assert.fail("expected the normalized-email collision domain error");
  }
  assert.equal(reason.code, "identity.email_conflict");
});

test("reissuing an activation token revokes the prior active token atomically", async () => {
  const operations: Array<{ name: string; input: unknown }> = [];
  const transaction = {
    accountActivationToken: {
      async updateMany(input: unknown): Promise<{ count: number }> {
        operations.push({ name: "revoke", input });
        return { count: 1 };
      },
      async create(input: unknown): Promise<void> {
        operations.push({ name: "create", input });
      },
    },
  };
  const adapter = new PrismaIdentityRepositoryAdapter(createTransactionPrisma(transaction));

  await adapter.issueActivationToken({
    id: TOKEN_ID,
    userId: USER_ID,
    scopeType: "platform",
    tenantId: null,
    invitationId: null,
    hostname: HOSTNAME,
    selector: "activation-selector",
    tokenHash: TOKEN_HASH,
    expiresAt: EXPIRES_AT,
    createdAt: NOW,
  });

  assert.deepEqual(
    operations.map((operation) => operation.name),
    ["revoke", "create"],
  );
  assert.deepEqual(operations[0]?.input, {
    where: {
      userId: USER_ID,
      scopeType: "platform",
      tenantId: null,
      hostname: HOSTNAME,
      consumedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: NOW },
  });
});

test("locks and consumes a valid activation token before activating the user", async () => {
  const operations: Array<{ name: string; input: unknown }> = [];
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
  const activatedUser = {
    ...userRow,
    status: "active" as const,
    activatedAt: NOW,
    updatedAt: NOW,
  };
  const transaction = {
    async $queryRawUnsafe(query: string, selector: string): Promise<(typeof tokenRow)[]> {
      operations.push({ name: "lock", input: { query, selector } });
      return [tokenRow];
    },
    passwordCredential: {
      async upsert(input: unknown): Promise<void> {
        operations.push({ name: "password", input });
      },
    },
    accountActivationToken: {
      async update(input: unknown): Promise<void> {
        operations.push({ name: "consume", input });
      },
    },
    user: {
      async update(input: unknown): Promise<typeof activatedUser> {
        operations.push({ name: "activate", input });
        return activatedUser;
      },
    },
  };
  const adapter = new PrismaIdentityRepositoryAdapter(createTransactionPrisma(transaction));

  const result = await adapter.consumeActivationToken({
    selector: tokenRow.selector,
    tokenHash: TOKEN_HASH,
    hostname: HOSTNAME,
    scopeType: "platform",
    tenantId: null,
    passwordHash: PASSWORD_HASH,
    now: NOW,
  });

  assert.equal(result.status, "active");
  assert.deepEqual(
    operations.map((operation) => operation.name),
    ["lock", "password", "consume", "activate"],
  );
  const lock = operations[0]?.input as { query: string; selector: string };
  assert.match(lock.query, /account_activation_tokens/i);
  assert.match(lock.query, /FOR UPDATE/i);
  assert.equal(lock.selector, tokenRow.selector);
});

test("rejects activation token binding and lifecycle failures with one generic error", async () => {
  const validRow = {
    id: TOKEN_ID,
    userId: USER_ID,
    scopeType: "platform" as const,
    tenantId: null,
    invitationId: null,
    hostname: HOSTNAME,
    selector: "activation-selector",
    tokenHash: TOKEN_HASH,
    expiresAt: EXPIRES_AT,
    consumedAt: null as Date | null,
    revokedAt: null as Date | null,
    createdAt: NOW,
  };
  const cases = [
    { ...validRow, hostname: "other.example.com" },
    { ...validRow, scopeType: "tenant" as const, tenantId: USER_ID },
    { ...validRow, expiresAt: new Date(NOW.getTime() - 1) },
    { ...validRow, consumedAt: NOW },
    { ...validRow, revokedAt: NOW },
    { ...validRow, tokenHash: "b".repeat(64) },
  ];

  for (const row of cases) {
    const transaction = {
      async $queryRawUnsafe(): Promise<(typeof row)[]> {
        return [row];
      },
      passwordCredential: {
        async upsert(): Promise<never> {
          throw new Error("invalid tokens must not store passwords");
        },
      },
      accountActivationToken: {
        async update(): Promise<never> {
          throw new Error("invalid tokens must not be consumed");
        },
      },
      user: {
        async update(): Promise<never> {
          throw new Error("invalid tokens must not activate users");
        },
      },
    };
    const adapter = new PrismaIdentityRepositoryAdapter(createTransactionPrisma(transaction));

    await assert.rejects(
      adapter.consumeActivationToken({
        selector: validRow.selector,
        tokenHash: TOKEN_HASH,
        hostname: HOSTNAME,
        scopeType: "platform",
        tenantId: null,
        passwordHash: PASSWORD_HASH,
        now: NOW,
      }),
      (error: unknown) =>
        error instanceof IdentityTokenInvalidError && error.code === "identity.token_invalid",
    );
  }
});

test("replaces the password, consumes reset state, and increments authorization version atomically", async () => {
  const operations: Array<{ name: string; input: unknown }> = [];
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
    async $queryRawUnsafe(query: string, selector: string): Promise<(typeof resetRow)[]> {
      operations.push({ name: "lock", input: { query, selector } });
      return [resetRow];
    },
    passwordCredential: {
      async upsert(input: unknown): Promise<void> {
        operations.push({ name: "password", input });
      },
    },
    passwordResetToken: {
      async update(input: unknown): Promise<void> {
        operations.push({ name: "consume", input });
      },
      async updateMany(input: unknown): Promise<{ count: number }> {
        operations.push({ name: "revoke-other-resets", input });
        return { count: 0 };
      },
    },
    user: {
      async update(input: unknown): Promise<void> {
        operations.push({ name: "version", input });
      },
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
  });

  assert.deepEqual(result, { userId: USER_ID });
  assert.deepEqual(
    operations.map((operation) => operation.name),
    ["lock", "password", "consume", "revoke-other-resets", "version"],
  );
  const lock = operations[0]?.input as { query: string };
  assert.match(lock.query, /password_reset_tokens/i);
  assert.match(lock.query, /FOR UPDATE/i);
  assert.deepEqual(operations[4]?.input, {
    where: { id: USER_ID },
    data: {
      authorizationVersion: { increment: 1 },
      updatedAt: NOW,
    },
  });
});
