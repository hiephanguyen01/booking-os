export interface SecurityAuditRecord {
  readonly eventType: string;
  readonly actorUserId: string | null;
  readonly subjectUserId: string | null;
  readonly requestId: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly occurredAt: Date;
}

export interface SecurityAuditPort {
  record(event: SecurityAuditRecord): Promise<void>;
}
