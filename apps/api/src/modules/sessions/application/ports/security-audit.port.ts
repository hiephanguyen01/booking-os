export interface SessionSecurityAuditRecord {
  readonly eventType:
    | "session.created"
    | "session.rotated"
    | "session.revoked"
    | "session.compromised";
  readonly actorUserId: string;
  readonly subjectUserId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface SessionSecurityAuditPort {
  record(record: SessionSecurityAuditRecord): Promise<void>;
}
