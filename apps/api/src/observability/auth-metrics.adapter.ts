import type { StructuredLogger } from "@booking-os/observability";

import type { AuthMetric, AuthMetricsPort } from "./auth-metrics.port.js";

export class StructuredAuthMetricsAdapter implements AuthMetricsPort {
  constructor(private readonly logger: StructuredLogger) {}

  record(metric: AuthMetric): void {
    this.logger.info("auth.security.metric", {
      eventType: metric.eventType,
      purpose: metric.purpose,
      outcome: metric.outcome,
      scope: metric.scope,
      reasonFamily: metric.reasonFamily,
      delayBucket: metric.delayBucket,
    });
  }
}
