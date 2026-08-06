import type { StructuredLogger } from "@booking-os/observability";

import type {
  LoginAbuseMetric,
  LoginAbuseMetricsPort,
} from "../../application/ports/login-abuse-metrics.port.js";

export class StructuredLoginAbuseMetricsAdapter implements LoginAbuseMetricsPort {
  constructor(private readonly logger: StructuredLogger) {}

  record(metric: LoginAbuseMetric): void {
    this.logger.info("login_abuse_protection.metric", {
      purpose: metric.purpose,
      outcome: metric.outcome,
      delayBucket: metric.delayBucket,
      availability: metric.availability,
    });
  }
}
