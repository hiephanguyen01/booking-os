import type {
  CreateStructuredLoggerOptions,
  LogContext,
  LogLevel,
  LogSink,
  LogValue,
  SerializedError,
  StructuredLogger,
  StructuredLogRecord,
} from "./types.js";

const PROTECTED_FIELDS = new Set(["level", "message", "timestamp", "error"]);

type SanitizedContext = Record<string, LogValue>;

function sanitizeContext(context: LogContext | undefined): SanitizedContext {
  const sanitized: SanitizedContext = {};

  for (const [key, value] of Object.entries(context ?? {})) {
    if (value !== undefined && !PROTECTED_FIELDS.has(key)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function serializeError(value: unknown): SerializedError {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }

  return {
    name: "Error",
    message: String(value),
  };
}

const defaultSink: LogSink = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

function createBoundLogger(
  boundContext: SanitizedContext,
  sink: LogSink,
  now: () => Date,
): StructuredLogger {
  function write(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: SerializedError,
  ): void {
    const record: StructuredLogRecord = {
      ...boundContext,
      ...sanitizeContext(context),
      level,
      message,
      timestamp: now().toISOString(),
      ...(error ? { error } : {}),
    };

    sink(record);
  }

  return {
    child(context) {
      return createBoundLogger(
        {
          ...boundContext,
          ...sanitizeContext(context),
        },
        sink,
        now,
      );
    },
    debug(message, context) {
      write("debug", message, context);
    },
    info(message, context) {
      write("info", message, context);
    },
    warn(message, context) {
      write("warn", message, context);
    },
    error(message, error, context) {
      write("error", message, context, serializeError(error));
    },
  };
}

export function createStructuredLogger(options: CreateStructuredLoggerOptions): StructuredLogger {
  return createBoundLogger(
    {
      ...sanitizeContext(options.context),
      service: options.service,
    },
    options.sink ?? defaultSink,
    options.now ?? (() => new Date()),
  );
}
