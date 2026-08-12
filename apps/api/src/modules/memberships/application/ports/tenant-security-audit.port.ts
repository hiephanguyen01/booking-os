import type { SecurityAuditEventType } from "../../../../common/security/security-audit-events.js";

export type TenantSecurityAuditEventType = Extract<
  SecurityAuditEventType,
  `membership.${string}` | `tenant.${string}` | "platform.bootstrap_admin_created"
>;

export interface TenantSecurityAuditInput {
  readonly eventType: TenantSecurityAuditEventType;
  readonly actorUserId: string | null;
  readonly subjectUserId: string | null;
  readonly requestId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface TenantSecurityAuditPort {
  append(input: TenantSecurityAuditInput): Promise<void>;
}
