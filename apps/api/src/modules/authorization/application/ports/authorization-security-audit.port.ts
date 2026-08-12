import type { PermissionKey } from "@booking-os/auth";

export type AuthorizationDenialReason =
  | "session_inactive"
  | "authorization_snapshot_missing"
  | "authority_invalid"
  | "session_ineligible"
  | "subject_inactive"
  | "authority_mismatch";

export interface AuthorizationDeniedAuditRecord {
  readonly eventType: "authorization.denied";
  readonly actorUserId: string;
  readonly subjectUserId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly permission: PermissionKey;
  readonly scopeType: "platform" | "tenant";
  readonly tenantId: string | null;
  readonly reason: AuthorizationDenialReason;
  readonly occurredAt: Date;
}

export interface AuthorizationSecurityAuditPort {
  recordDenied(record: AuthorizationDeniedAuditRecord): Promise<void>;
}
