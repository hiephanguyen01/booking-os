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

  async markFailed(): Promise<"retryable" | "dead-lettered"> {
    return "retryable";
  }
}

class RecordingQueue implements OutboxQueue {
  readonly calls: Array<{ name: string; data: unknown; jobId: string }> = [];

  async add(name: string, data: unknown, options: { readonly jobId: string }): Promise<void> {
    this.calls.push({ name, data, jobId: options.jobId });
  }
}

test("dispatches the same event at most once", async () => {
  const repository = new MemoryOutboxRepository({
    id: EVENT_ID,
    tenantId: "11111111-1111-4111-8111-111111111111",
    type: "FoundationProbeCreated",
    aggregateType: "tenant_probe",
    aggregateId: "33333333-3333-4333-8333-333333333333",
    payload: { value: "created" },
    attempts: 0,
  });
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
      jobId: EVENT_ID,
    },
  ]);
});
