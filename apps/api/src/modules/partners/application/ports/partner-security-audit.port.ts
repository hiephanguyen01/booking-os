import type { SecurityAuditEventType } from "../../../../common/security/security-audit-events.js";

export type PartnerSecurityAuditEventType = Extract<SecurityAuditEventType, `partner.${string}`>;

export interface PartnerSecurityAuditInput {
  readonly eventType: PartnerSecurityAuditEventType;
  readonly actorUserId: string | null;
  readonly subjectUserId: string | null;
  readonly requestId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface PartnerSecurityAuditPort {
  append(input: PartnerSecurityAuditInput): Promise<void>;
}
