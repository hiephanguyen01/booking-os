import type { ReadinessFailureReason } from "./readiness-probe.js";

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConnectionCode(code: string): boolean {
  return CONNECTION_CODES.has(code) || code.startsWith("08") || code.startsWith("28");
}

function isRedisAuthenticationFailure(message: string): boolean {
  return message.startsWith("WRONGPASS ") || message.startsWith("NOAUTH ");
}

export function classifyReadinessError(error: unknown): ReadinessFailureReason {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
  if (code !== undefined && isConnectionCode(code)) {
    return "connection_failed";
  }

  if (error instanceof Error && isRedisAuthenticationFailure(error.message)) {
    return "connection_failed";
  }

  return "unexpected_response";
}
