import type { SecurityAuditEventType } from "../../../../common/security/security-audit-events.js";

export type SessionSecurityAuditEventType = Extract<SecurityAuditEventType, `session.${string}`>;

export interface SessionSecurityAuditRecord {
  readonly eventType: SessionSecurityAuditEventType;
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
