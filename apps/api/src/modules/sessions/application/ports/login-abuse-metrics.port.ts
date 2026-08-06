export type LoginAbuseMetricPurpose = "before_attempt" | "record_failure" | "record_success";

export type LoginAbuseMetricOutcome = "allowed" | "delayed" | "failure" | "success" | "unavailable";

export type LoginAbuseDelayBucket = "none" | "lt_1s" | "1_4s" | "gte_4s";

export interface LoginAbuseMetric {
  readonly purpose: LoginAbuseMetricPurpose;
  readonly outcome: LoginAbuseMetricOutcome;
  readonly delayBucket: LoginAbuseDelayBucket;
  readonly availability: "available" | "unavailable";
}

export interface LoginAbuseMetricsPort {
  record(metric: LoginAbuseMetric): void;
}
