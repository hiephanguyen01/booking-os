import type { DispatchableOutboxEvent, DispatchSummary, OutboxJobPayload } from "./outbox-event.js";

const DEFAULT_MAX_ATTEMPTS = 5;
const IDENTITY_EMAIL_MAX_ATTEMPTS = 5;
const IDENTITY_EMAIL_RETRY_DELAY_MS = 1_000;

export interface OutboxDispatchRepository {
  claimBatch(limit: number): Promise<readonly DispatchableOutboxEvent[]>;
  markDispatched(eventId: string): Promise<void>;
  markFailed(
    eventId: string,
    sanitizedError: string,
    maxAttempts: number,
  ): Promise<"retryable" | "dead-lettered">;
}

export interface OutboxJobOptions {
  readonly jobId: string;
  readonly attempts?: number;
  readonly backoff?: {
    readonly type: "exponential";
    readonly delay: number;
  };
  readonly removeOnComplete?: boolean;
}

export interface OutboxQueue {
  add(name: string, data: OutboxJobPayload, options: OutboxJobOptions): Promise<unknown>;
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

function isIdentityEmailEvent(type: string): boolean {
  return (
    type === "identity.activation.requested.v1" ||
    type === "identity.password_reset.requested.v1" ||
    type === "membership.admin_invitation.requested.v1" ||
    type === "membership.owner_invitation.requested.v1"
  );
}

function jobOptions(event: DispatchableOutboxEvent): OutboxJobOptions {
  if (!isIdentityEmailEvent(event.type)) {
    return { jobId: event.id };
  }

  return {
    jobId: event.id,
    attempts: IDENTITY_EMAIL_MAX_ATTEMPTS,
    backoff: { type: "exponential", delay: IDENTITY_EMAIL_RETRY_DELAY_MS },
    removeOnComplete: true,
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
        await this.queue.add(event.type, jobPayload(event), jobOptions(event));
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
