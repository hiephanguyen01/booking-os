import type { WorkerDatabase } from "../database/worker-database.js";
import type { OutboxDispatchRepository } from "./outbox-dispatcher.js";
import type { DispatchableOutboxEvent } from "./outbox-event.js";

const CLAIM_TIMEOUT_MINUTES = 5;
const MAX_BACKOFF_SECONDS = 60 * 60;

interface ClaimedOutboxRow {
  readonly id: string;
  readonly tenantId: string | null;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly attempts: number;
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.min(attempts, 10));
}

export class PrismaOutboxRepository implements OutboxDispatchRepository {
  private readonly database: WorkerDatabase;

  constructor(database: WorkerDatabase) {
    this.database = database;
  }

  claimBatch(limit: number): Promise<readonly DispatchableOutboxEvent[]> {
    return this.database.run((transaction) =>
      transaction.$queryRaw<ClaimedOutboxRow[]>`
        WITH candidates AS (
          SELECT "id"
          FROM "outbox_events"
          WHERE "dispatched_at" IS NULL
            AND "dead_lettered_at" IS NULL
            AND "available_at" <= CURRENT_TIMESTAMP
            AND (
              "claimed_at" IS NULL
              OR "claimed_at" < CURRENT_TIMESTAMP - (${CLAIM_TIMEOUT_MINUTES} * INTERVAL '1 minute')
            )
          ORDER BY "occurred_at" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "outbox_events" AS event
        SET
          "claimed_at" = CURRENT_TIMESTAMP,
          "attempts" = event."attempts" + 1
        FROM candidates
        WHERE event."id" = candidates."id"
        RETURNING
          event."id",
          event."tenant_id" AS "tenantId",
          event."type",
          event."aggregate_type" AS "aggregateType",
          event."aggregate_id" AS "aggregateId",
          event."payload",
          event."attempts"
      `,
    );
  }

  async markDispatched(eventId: string): Promise<void> {
    await this.database.run(async (transaction) => {
      await transaction.outboxEvent.update({
        where: { id: eventId },
        data: {
          dispatchedAt: new Date(),
          claimedAt: null,
          lastError: null,
        },
      });
    });
  }

  markFailed(
    eventId: string,
    sanitizedError: string,
    maxAttempts: number,
  ): Promise<"retryable" | "dead-lettered"> {
    return this.database.run(async (transaction) => {
      const event = await transaction.outboxEvent.findUniqueOrThrow({
        where: { id: eventId },
        select: { attempts: true, firstFailedAt: true },
      });
      const now = new Date();
      const deadLettered = event.attempts >= maxAttempts;

      await transaction.outboxEvent.update({
        where: { id: eventId },
        data: {
          lastError: sanitizedError.slice(0, 256),
          firstFailedAt: event.firstFailedAt ?? now,
          lastFailedAt: now,
          claimedAt: null,
          ...(deadLettered
            ? { deadLetteredAt: now }
            : { availableAt: new Date(now.getTime() + retryDelaySeconds(event.attempts) * 1000) }),
        },
      });

      return deadLettered ? "dead-lettered" : "retryable";
    });
  }
}
