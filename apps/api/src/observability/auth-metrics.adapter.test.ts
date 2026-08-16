import assert from "node:assert/strict";
import test from "node:test";

import type { StructuredLogger } from "@booking-os/observability";
import { StructuredAuthMetricsAdapter } from "./auth-metrics.adapter.js";
import type { AuthMetric } from "./auth-metrics.port.js";

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

const METRIC: AuthMetric = Object.freeze({
  eventType: "session",
  purpose: "revoke",
  outcome: "success",
  scope: "platform",
  reasonFamily: "security_incident",
  delayBucket: "none",
});

test("emits only bounded authentication metric labels", () => {
  const logger = new FakeLogger();
  const metrics = new StructuredAuthMetricsAdapter(logger);

  metrics.record({
    ...METRIC,
    userId: "user-123",
    email: "owner@example.test",
  } as AuthMetric & { readonly userId: string; readonly email: string });

  assert.deepEqual(logger.infoCalls, [
    {
      message: "auth.security.metric",
      context: {
        eventType: "session",
        purpose: "revoke",
        outcome: "success",
        scope: "platform",
        reasonFamily: "security_incident",
        delayBucket: "none",
      },
    },
  ]);
  assert.deepEqual(Object.keys(logger.infoCalls[0]?.context ?? {}).sort(), [
    "delayBucket",
    "eventType",
    "outcome",
    "purpose",
    "reasonFamily",
    "scope",
  ]);
});
