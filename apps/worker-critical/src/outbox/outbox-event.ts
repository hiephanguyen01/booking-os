export interface DispatchableOutboxEvent {
  readonly id: string;
  readonly tenantId: string | null;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly attempts: number;
}

export interface OutboxJobPayload {
  readonly eventId: string;
  readonly tenantId: string | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
}

export interface DispatchSummary {
  readonly claimed: number;
  readonly dispatched: number;
  readonly failed: number;
  readonly deadLettered: number;
}
