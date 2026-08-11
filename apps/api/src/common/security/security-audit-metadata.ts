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

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BEARER_CREDENTIAL_PATTERN = /^bearer\s+\S+/i;
const COOKIE_CREDENTIAL_PATTERN = /(?:^|;\s*)[A-Za-z0-9_.-]+=[^;\s]+/;

function normalizeMetadataKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isProhibitedKey(key: string): boolean {
  const normalized = normalizeMetadataKey(key);
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

export function assertSafeSecurityAuditMetadata(
  metadata: Readonly<Record<string, string | number | boolean | null>>,
): void {
  for (const [key, value] of Object.entries(metadata)) {
    if (isProhibitedKey(key)) {
      throw new Error(`Security audit metadata contains prohibited field: ${key}`);
    }

    if (typeof value === "string" && isCredentialLikeValue(value)) {
      throw new Error(`Security audit metadata contains sensitive value in field: ${key}`);
    }
  }
}
