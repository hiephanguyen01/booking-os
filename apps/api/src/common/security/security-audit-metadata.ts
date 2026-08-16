const PROHIBITED_KEY_FRAGMENTS = [
  "password",
  "passphrase",
  "cookie",
  "authorization",
  "bearer",
  "token",
  "secret",
  "apikey",
  "envelope",
  "email",
] as const;

const SAFE_METADATA_KEYS = new Set(["authorizationversion"]);
const MAX_METADATA_DEPTH = 12;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BEARER_CREDENTIAL_PATTERN = /^bearer\s+\S+/i;
const COOKIE_CREDENTIAL_PATTERN = /(?:^|;\s*)[A-Za-z0-9_.-]+=[^;\s]+/;

function normalizeMetadataKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isProhibitedKey(key: string): boolean {
  const normalized = normalizeMetadataKey(key);
  if (SAFE_METADATA_KEYS.has(normalized)) {
    return false;
  }

  return PROHIBITED_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function isCredentialLikeValue(value: string): boolean {
  const trimmed = value.trim();
  return (
    EMAIL_ADDRESS_PATTERN.test(trimmed) ||
    BEARER_CREDENTIAL_PATTERN.test(trimmed) ||
    COOKIE_CREDENTIAL_PATTERN.test(trimmed)
  );
}

function assertSafeValue(value: unknown, depth: number, ancestors: WeakSet<object>): void {
  if (typeof value === "string") {
    if (isCredentialLikeValue(value)) {
      throw new Error("Security audit metadata contains a sensitive string value");
    }
    return;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return;
  }

  if (typeof value !== "object") {
    throw new Error("Security audit metadata contains an unsupported value");
  }

  if (depth > MAX_METADATA_DEPTH) {
    throw new Error("Security audit metadata exceeds safe structural bounds");
  }

  if (ancestors.has(value)) {
    throw new Error("Security audit metadata contains a circular reference");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        assertSafeValue(item, depth + 1, ancestors);
      }
      return;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (isProhibitedKey(key)) {
        throw new Error(`Security audit metadata contains prohibited field: ${key}`);
      }
      assertSafeValue(nestedValue, depth + 1, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

export function assertSafeSecurityAuditMetadata(metadata: Readonly<Record<string, unknown>>): void {
  assertSafeValue(metadata, 0, new WeakSet<object>());
}
