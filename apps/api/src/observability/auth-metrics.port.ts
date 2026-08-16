export type AuthMetricEventType =
  | "login"
  | "progressive_delay"
  | "token"
  | "invitation"
  | "session"
  | "authorization"
  | "tenant_provisioning";

export type AuthMetricPurpose =
  | "attempt"
  | "issue"
  | "consume"
  | "expire"
  | "accept"
  | "create"
  | "revoke"
  | "reuse"
  | "check"
  | "provision";

export type AuthMetricOutcome =
  | "success"
  | "failure"
  | "allowed"
  | "denied"
  | "expired"
  | "revoked"
  | "reuse_detected"
  | "delayed";

export type AuthMetricScope = "platform" | "tenant" | "none";

export type AuthMetricReasonFamily =
  | "none"
  | "credentials"
  | "rate_limit"
  | "security_incident"
  | "token_state"
  | "membership_state"
  | "authorization_policy"
  | "provisioning";

export type AuthMetricDelayBucket = "none" | "lt_1s" | "1_4s" | "gte_4s";

export interface AuthMetric {
  readonly eventType: AuthMetricEventType;
  readonly purpose: AuthMetricPurpose;
  readonly outcome: AuthMetricOutcome;
  readonly scope: AuthMetricScope;
  readonly reasonFamily: AuthMetricReasonFamily;
  readonly delayBucket: AuthMetricDelayBucket;
}

export interface AuthMetricsPort {
  record(metric: AuthMetric): void;
}
