import type { LogContext, LogLevel, StructuredLogRecord } from "@booking-os/observability";

export interface LogRecordFixtureOverrides extends LogContext {
  readonly level?: LogLevel;
  readonly message?: string;
  readonly timestamp?: string;
}

export function createLogRecordFixture(
  overrides: LogRecordFixtureOverrides = {},
): StructuredLogRecord {
  const {
    level = "info",
    message = "job.completed",
    timestamp = "2026-08-03T12:00:00.000Z",
    service = "worker-critical",
    ...context
  } = overrides;

  return {
    ...context,
    level,
    message,
    service,
    timestamp,
  };
}
