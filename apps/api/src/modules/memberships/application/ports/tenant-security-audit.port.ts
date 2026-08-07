export interface TenantSecurityAuditInput {
  readonly eventType: string;
  readonly actorUserId: string | null;
  readonly subjectUserId: string | null;
  readonly requestId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface TenantSecurityAuditPort {
  append(input: TenantSecurityAuditInput): Promise<void>;
}
