export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogValue = string | number | boolean | null;

export interface LogContext {
  readonly requestId?: string;
  readonly traceId?: string;
  readonly actorId?: string;
  readonly jobId?: string;
  readonly jobName?: string;
  readonly tenantId?: string;
  readonly service?: string;
  readonly [key: string]: LogValue | undefined;
}

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export interface StructuredLogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly error?: SerializedError;
  readonly [key: string]: LogValue | SerializedError | undefined;
}

export type LogSink = (record: StructuredLogRecord) => void;

export interface StructuredLogger {
  child(context: LogContext): StructuredLogger;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error: unknown, context?: LogContext): void;
}

export interface CreateStructuredLoggerOptions {
  readonly service: string;
  readonly context?: LogContext;
  readonly contextProvider?: () => LogContext | undefined;
  readonly sink?: LogSink;
  readonly now?: () => Date;
}
