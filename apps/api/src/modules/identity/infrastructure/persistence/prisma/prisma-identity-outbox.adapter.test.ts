import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import { OutboxRepository } from "../../../../../reliability/outbox.repository.js";
import type { IssueActivationEmailInput } from "../../../application/ports/identity-outbox.port.js";
import { PrismaIdentityOutboxAdapter } from "./prisma-identity-outbox.adapter.js";

const NOW = new Date("2026-08-05T09:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";

function activationInput(): IssueActivationEmailInput {
  return {
    token: {
      id: TOKEN_ID,
      userId: USER_ID,
      scopeType: "platform",
      tenantId: null,
      invitationId: null,
      hostname: "console.example.com",
      selector: "activation-selector",
      tokenHash: "a".repeat(64),
      expiresAt: new Date("2026-08-06T09:00:00.000Z"),
      createdAt: NOW,
    },
    event: {
      id: EVENT_ID,
      type: "identity.activation.requested.v1",
      tenantId: null,
      aggregateType: "user",
      aggregateId: USER_ID,
      occurredAt: NOW,
      payload: {
        version: 1,
        recipient: "Owner@example.com",
        template: "account_activation",
        hostname: "console.example.com",
        envelope: {
          version: 1,
          keyId: "key-1",
          iv: "iv",
          ciphertext: "ciphertext",
          tag: "tag",
        },
      },
    },
  };
}

test("revokes, creates, and appends activation email inside one database transaction", async () => {
  const operations: string[] = [];
  const transaction = {
    accountActivationToken: {
      async updateMany(): Promise<{ count: number }> {
        operations.push("revoke-token");
        return { count: 1 };
      },
      async create(): Promise<void> {
        operations.push("create-token");
      },
    },
    outboxEvent: {
      async create(input: { readonly data: { readonly payload: unknown } }): Promise<void> {
        operations.push("append-event");
        assert.doesNotMatch(JSON.stringify(input.data.payload), /activation-selector/u);
      },
    },
  };
  let transactions = 0;
  const prisma = {
    async $transaction<T>(work: (client: typeof transaction) => Promise<T>): Promise<T> {
      transactions += 1;
      return work(transaction);
    },
  } as unknown as PrismaService;
  const adapter = new PrismaIdentityOutboxAdapter(prisma, new OutboxRepository());

  await adapter.issueActivation(activationInput());

  assert.equal(transactions, 1);
  assert.deepEqual(operations, ["revoke-token", "create-token", "append-event"]);
});
