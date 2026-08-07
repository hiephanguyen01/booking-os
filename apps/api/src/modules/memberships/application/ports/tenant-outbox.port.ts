export interface AppendTenantOutboxEventInput {
  readonly id: string;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly availableAt?: Date;
}

export interface TenantOutboxPort {
  append(input: AppendTenantOutboxEventInput): Promise<void>;
}
