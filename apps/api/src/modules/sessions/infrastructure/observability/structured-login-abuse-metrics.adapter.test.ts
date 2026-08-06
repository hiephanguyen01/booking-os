import assert from "node:assert/strict";
import test from "node:test";

import type { StructuredLogger } from "@booking-os/observability";

import type { LoginAbuseMetric } from "../../application/ports/login-abuse-metrics.port.js";
import { StructuredLoginAbuseMetricsAdapter } from "./structured-login-abuse-metrics.adapter.js";

interface InfoCall {
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>> | undefined;
}

class FakeLogger implements StructuredLogger {
  readonly infoCalls: InfoCall[] = [];

  child(): StructuredLogger {
    return this;
  }

  debug(): void {}

  info(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.infoCalls.push({ message, context });
  }

  warn(): void {}

  error(): void {}
}

const METRIC: LoginAbuseMetric = Object.freeze({
  purpose: "before_attempt",
  outcome: "delayed",
  delayBucket: "1_4s",
  availability: "available",
});

test("emits only bounded login abuse metric labels", () => {
  const logger = new FakeLogger();
  const metrics = new StructuredLoginAbuseMetricsAdapter(logger);

  metrics.record(METRIC);

  assert.deepEqual(logger.infoCalls, [
    {
      message: "login_abuse_protection.metric",
      context: {
        purpose: "before_attempt",
        outcome: "delayed",
        delayBucket: "1_4s",
        availability: "available",
      },
    },
  ]);
  assert.deepEqual(Object.keys(logger.infoCalls[0]?.context ?? {}).sort(), [
    "availability",
    "delayBucket",
    "outcome",
    "purpose",
  ]);
});
