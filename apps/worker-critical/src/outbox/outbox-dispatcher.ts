import type {
  DispatchableOutboxEvent,
  DispatchSummary,
  OutboxJobPayload,
} from "./outbox-event.js";

const DEFAULT_MAX_ATTEMPTS = 5;

export interface OutboxDispatchRepository {
  claimBatch(limit: number): Promise<readonly DispatchableOutboxEvent[]>;
  markDispatched(eventId: string): Promise<void>;
  markFailed(
    eventId: string,
    sanitizedError: string,
    maxAttempts: number,
  ): Promise<"retryable" | "dead-lettered">;
}

export interface OutboxQueue {
  add(
    name: string,
    data: OutboxJobPayload,
    options: { readonly jobId: string },
  ): Promise<unknown>;
}

export interface OutboxDispatcherOptions {
  readonly maxAttempts?: number;
}

function sanitizedError(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 128) : "UnknownError";
}

function jobPayload(event: DispatchableOutboxEvent): OutboxJobPayload {
  return {
    eventId: event.id,
    tenantId: event.tenantId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: event.payload,
  };
}

export class OutboxDispatcher {
  private readonly maxAttempts: number;

  constructor(
    private readonly repository: OutboxDispatchRepository,
    private readonly queue: OutboxQueue,
    options: OutboxDispatcherOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw new RangeError("Outbox max attempts must be a positive integer.");
    }
  }

  async dispatchBatch(limit: number): Promise<DispatchSummary> {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new RangeError("Outbox batch limit must be a positive integer.");
    }

    const events = await this.repository.claimBatch(limit);
    let dispatched = 0;
    let failed = 0;
    let deadLettered = 0;

    for (const event of events) {
      try {
        await this.queue.add(event.type, jobPayload(event), { jobId: event.id });
        await this.repository.markDispatched(event.id);
        dispatched += 1;
      } catch (error: unknown) {
        const outcome = await this.repository.markFailed(
          event.id,
          sanitizedError(error),
          this.maxAttempts,
        );

        if (outcome === "dead-lettered") {
          deadLettered += 1;
        } else {
          failed += 1;
        }
      }
    }

    return {
      claimed: events.length,
      dispatched,
      failed,
      deadLettered,
    };
  }
}
