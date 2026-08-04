import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import type { AppendOutboxEvent } from "./outbox-event.js";

@Injectable()
export class OutboxRepository {
  async append(
    transaction: Prisma.TransactionClient,
    event: AppendOutboxEvent,
  ): Promise<void> {
    await transaction.outboxEvent.create({
      data: {
        id: event.id,
        tenantId: event.tenantId ?? null,
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }),
        ...(event.availableAt === undefined ? {} : { availableAt: event.availableAt }),
      },
    });
  }
}
