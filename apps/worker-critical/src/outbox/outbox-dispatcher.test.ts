import assert from "node:assert/strict";
import test from "node:test";

import {
  OutboxDispatcher,
  type OutboxDispatchRepository,
  type OutboxQueue,
} from "./outbox-dispatcher.js";
import type { DispatchableOutboxEvent } from "./outbox-event.js";

const EVENT_ID = "44444444-4444-4444-8444-444444444444";

class MemoryOutboxRepository implements OutboxDispatchRepository {
  readonly failedErrors: string[] = [];
  private dispatched = false;
  private attempts = 0;

  constructor(private readonly event: DispatchableOutboxEvent) {}

  async claimBatch(_limit: number): Promise<readonly DispatchableOutboxEvent[]> {
    if (this.dispatched) {
      return [];
    }

    this.attempts += 1;
    return [{ ...this.event, attempts: this.attempts }];
  }

  async markDispatched(eventId: string): Promise<void> {
    assert.equal(eventId, this.event.id);
    this.dispatched = true;
  }

  async markFailed(
    eventId: string,
    sanitizedError: string,
  ): Promise<"retryable" | "dead-lettered"> {
    assert.equal(eventId, this.event.id);
    this.failedErrors.push(sanitizedError);
    this.dispatched = true;
    return "retryable";
  }
}

class RecordingQueue implements OutboxQueue {
  readonly calls: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = [];

  async add(name: string, data: unknown, options: { readonly jobId: string }): Promise<void> {
    this.calls.push({ name, data, options });
  }
}

class FailingQueue implements OutboxQueue {
  constructor(private readonly error: Error) {}

  async add(): Promise<void> {
    throw this.error;
  }
}

function eventFixture(payload: unknown = { value: "created" }): DispatchableOutboxEvent {
  return {
    id: EVENT_ID,
    tenantId: "11111111-1111-4111-8111-111111111111",
    type: "FoundationProbeCreated",
    aggregateType: "tenant_probe",
    aggregateId: "33333333-3333-4333-8333-333333333333",
    payload,
    attempts: 0,
  };
}

test("dispatches the same event at most once", async () => {
  const repository = new MemoryOutboxRepository(eventFixture());
  const queue = new RecordingQueue();
  const dispatcher = new OutboxDispatcher(repository, queue);

  const first = await dispatcher.dispatchBatch(10);
  const second = await dispatcher.dispatchBatch(10);

  assert.deepEqual(first, { claimed: 1, dispatched: 1, failed: 0, deadLettered: 0 });
  assert.deepEqual(second, { claimed: 0, dispatched: 0, failed: 0, deadLettered: 0 });
  assert.deepEqual(queue.calls, [
    {
      name: "FoundationProbeCreated",
      data: {
        eventId: EVENT_ID,
        tenantId: "11111111-1111-4111-8111-111111111111",
        aggregateType: "tenant_probe",
        aggregateId: "33333333-3333-4333-8333-333333333333",
        payload: { value: "created" },
      },
      options: { jobId: EVENT_ID },
    },
  ]);
});

test("configures bounded exponential retries for identity email jobs", async () => {
  const event: DispatchableOutboxEvent = {
    ...eventFixture(),
    tenantId: null,
    type: "identity.activation.requested.v1",
    aggregateType: "user",
  };
  const repository = new MemoryOutboxRepository(event);
  const queue = new RecordingQueue();
  const dispatcher = new OutboxDispatcher(repository, queue);

  await dispatcher.dispatchBatch(10);

  assert.deepEqual(queue.calls[0]?.options, {
    jobId: EVENT_ID,
    attempts: 5,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: true,
  });
});

test("configures bounded exponential retries for platform owner invitation email jobs", async () => {
  const event: DispatchableOutboxEvent = {
    ...eventFixture(),
    type: "membership.owner_invitation.requested.v1",
    aggregateType: "membership_invitation",
  };
  const repository = new MemoryOutboxRepository(event);
  const queue = new RecordingQueue();
  const dispatcher = new OutboxDispatcher(repository, queue);

  await dispatcher.dispatchBatch(10);

  assert.deepEqual(queue.calls[0]?.options, {
    jobId: EVENT_ID,
    attempts: 5,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: true,
  });
});

test("persists only a sanitized error name when queue delivery fails", async () => {
  const repository = new MemoryOutboxRepository(
    eventFixture({ password: "payload-secret", databaseUrl: "postgresql://user:secret@db" }),
  );
  const dispatcher = new OutboxDispatcher(
    repository,
    new FailingQueue(new Error("credential-secret payload-secret")),
  );

  const summary = await dispatcher.dispatchBatch(10);

  assert.deepEqual(summary, { claimed: 1, dispatched: 0, failed: 1, deadLettered: 0 });
  assert.deepEqual(repository.failedErrors, ["Error"]);
  assert.equal(JSON.stringify(repository.failedErrors).includes("credential-secret"), false);
  assert.equal(JSON.stringify(repository.failedErrors).includes("payload-secret"), false);
});
