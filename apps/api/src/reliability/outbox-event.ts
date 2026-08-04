import type { Prisma } from "@prisma/client";

export interface AppendOutboxEvent {
  readonly id: string;
  readonly tenantId?: string | null;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Prisma.InputJsonValue;
  readonly occurredAt?: Date;
  readonly availableAt?: Date;
}
