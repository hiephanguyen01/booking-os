const REDACTED_VALUE = "[REDACTED]";
const MAX_REDACTION_DEPTH = 12;

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "csrftoken",
  "emailbody",
  "envelope",
  "idtoken",
  "newpassword",
  "otp",
  "password",
  "refreshtoken",
  "requestheaders",
  "responseheaders",
  "secret",
  "setcookie",
  "token",
  "verificationcode",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

function redactValue(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (depth >= MAX_REDACTION_DEPTH || ancestors.has(value)) {
    return REDACTED_VALUE;
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, depth + 1, ancestors));
    }

    const redacted: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      redacted[key] = isSensitiveKey(key)
        ? REDACTED_VALUE
        : redactValue(nestedValue, depth + 1, ancestors);
    }

    return redacted;
  } finally {
    ancestors.delete(value);
  }
}

export function redactSensitiveData<T>(value: T): T {
  return redactValue(value, 0, new WeakSet<object>()) as T;
}
