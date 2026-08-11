import { redactSensitiveData } from "./redaction.js";
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
const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_ERROR_MARKER =
  /\b(?:access[_ -]?token|api[_ -]?key|authorization|bearer|client[_ -]?secret|cookie|csrf[_ -]?token|email[_ -]?body|envelope|id[_ -]?token|new[_ -]?password|otp|password|refresh[_ -]?token|secret|set-cookie|token|verification[_ -]?code)\b/iu;
const EMAIL_ADDRESS =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/iu;
const CREDENTIAL_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/iu;

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

function containsSensitiveDiagnostic(value: string): boolean {
  return (
    SENSITIVE_ERROR_MARKER.test(value) || EMAIL_ADDRESS.test(value) || CREDENTIAL_URL.test(value)
  );
}

function serializeError(value: unknown): SerializedError {
  if (value instanceof Error) {
    if (containsSensitiveDiagnostic(value.message)) {
      return {
        name: value.name,
        message: REDACTED_VALUE,
      };
    }

    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }

  const message = String(value);
  return {
    name: "Error",
    message: containsSensitiveDiagnostic(message) ? REDACTED_VALUE : message,
  };
}

const defaultSink: LogSink = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

function createBoundLogger(
  boundContext: SanitizedContext,
  sink: LogSink,
  now: () => Date,
  contextProvider: (() => LogContext | undefined) | undefined,
): StructuredLogger {
  function write(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: SerializedError,
  ): void {
    const record: StructuredLogRecord = {
      ...boundContext,
      ...sanitizeContext(contextProvider?.()),
      ...sanitizeContext(context),
      level,
      message,
      timestamp: now().toISOString(),
      ...(error ? { error } : {}),
    };

    sink(redactSensitiveData(record));
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
        contextProvider,
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
    options.contextProvider,
  );
}
