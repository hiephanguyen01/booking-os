const REDACTED_VALUE = "[REDACTED]";

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

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactValue(nestedValue);
  }

  return redacted;
}

export function redactSensitiveData<T>(value: T): T {
  return redactValue(value) as T;
}
