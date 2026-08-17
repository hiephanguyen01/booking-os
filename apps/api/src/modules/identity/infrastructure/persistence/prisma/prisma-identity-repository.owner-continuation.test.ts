import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaIdentityRepositoryAdapter } from "./prisma-identity-repository.adapter.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const INVITATION_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-08-05T08:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-06T08:00:00.000Z");
const TOKEN_HASH = "a".repeat(64);
const PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=1$test$hash";
const HOSTNAME = "tenant.example.com";

const activatedUser = {
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

const tokenRow = {
  id: TOKEN_ID,
  userId: USER_ID,
  scopeType: "tenant" as const,
  tenantId: TENANT_ID,
  invitationId: INVITATION_ID,
  hostname: HOSTNAME,
  selector: "activation-selector",
  tokenHash: TOKEN_HASH,
  expiresAt: EXPIRES_AT,
  consumedAt: null,
  revokedAt: null,
  createdAt: NOW,
};

function createTransactionPrisma(transaction: object): PrismaService {
  return {
    async $transaction<T>(callback: (value: object) => Promise<T>): Promise<T> {
      return callback(transaction);
    },
  } as unknown as PrismaService;
}

function createTenantActivationTransaction(
  invitation: { readonly intendedRoleKey: string } | null,
  observations: {
    readonly roleStatements: string[];
    readonly tenantConfigIds: string[];
    readonly invitationQueries: unknown[];
  },
): object {
  return {
    async $queryRawUnsafe(): Promise<(typeof tokenRow)[]> {
      return [tokenRow];
    },
    async $executeRawUnsafe(query: string): Promise<number> {
      observations.roleStatements.push(query);
      return 0;
    },
    async $executeRaw(_strings: TemplateStringsArray, tenantId: string): Promise<number> {
      observations.tenantConfigIds.push(tenantId);
      return 0;
    },
    passwordCredential: {
      async upsert(): Promise<void> {},
    },
    accountActivationToken: {
      async update(): Promise<void> {},
    },
    user: {
      async update(): Promise<typeof activatedUser> {
        return activatedUser;
      },
    },
    securityAuditEvent: {
      async create(): Promise<void> {},
    },
    membershipInvitation: {
      async findFirst(input: unknown): Promise<typeof invitation> {
        observations.invitationQueries.push(input);
        return invitation;
      },
    },
  };
}

function activationInput() {
  return {
    selector: tokenRow.selector,
    tokenHash: TOKEN_HASH,
    hostname: HOSTNAME,
    scopeType: "tenant" as const,
    tenantId: TENANT_ID,
    passwordHash: PASSWORD_HASH,
    now: NOW,
    requestId: "owner-activation-request",
  };
}

test("returns linked owner invitation context through the tenant RLS boundary", async () => {
  const observations = {
    roleStatements: [] as string[],
    tenantConfigIds: [] as string[],
    invitationQueries: [] as unknown[],
  };
  const transaction = createTenantActivationTransaction(
    { intendedRoleKey: "tenant_owner" },
    observations,
  );
  const adapter = new PrismaIdentityRepositoryAdapter(createTransactionPrisma(transaction));

  const result = await adapter.consumeActivationToken(activationInput());

  assert.equal(result.invitationId, INVITATION_ID);
  assert.equal(result.intendedRoleKey, "tenant_owner");
  assert.deepEqual(observations.roleStatements, ["SET LOCAL ROLE booking_app"]);
  assert.deepEqual(observations.tenantConfigIds, [TENANT_ID]);
  assert.deepEqual(observations.invitationQueries, [
    {
      where: {
        id: INVITATION_ID,
        tenantId: TENANT_ID,
        invitedUserId: USER_ID,
      },
      select: { intendedRoleKey: true },
    },
  ]);
});

test("fails closed when the activation-linked invitation cannot be resolved", async () => {
  const observations = {
    roleStatements: [] as string[],
    tenantConfigIds: [] as string[],
    invitationQueries: [] as unknown[],
  };
  const transaction = createTenantActivationTransaction(null, observations);
  const adapter = new PrismaIdentityRepositoryAdapter(createTransactionPrisma(transaction));

  const result = await adapter.consumeActivationToken(activationInput());

  assert.equal(result.invitationId, INVITATION_ID);
  assert.equal(result.intendedRoleKey, null);
  assert.deepEqual(observations.roleStatements, ["SET LOCAL ROLE booking_app"]);
  assert.deepEqual(observations.tenantConfigIds, [TENANT_ID]);
  assert.equal(observations.invitationQueries.length, 1);
});
