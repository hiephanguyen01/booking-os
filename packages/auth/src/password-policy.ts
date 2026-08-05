export const MIN_PASSWORD_CODE_POINTS = 12;

const DEFAULT_COMMON_PASSWORDS = new Set([
  "123456789012",
  "letmein12345",
  "password123!",
  "qwerty123456",
  "welcome12345",
]);

export type PasswordPolicyErrorCode = "too_short" | "common_password";

export interface PasswordPolicyOptions {
  readonly commonPasswords?: ReadonlySet<string>;
}

export class PasswordPolicyError extends Error {
  constructor(readonly code: PasswordPolicyErrorCode) {
    super(code === "too_short" ? "Password is too short." : "Password is too common.");
    this.name = "PasswordPolicyError";
  }
}

export function normalizePassword(input: string): string {
  if (typeof input !== "string") {
    throw new TypeError("Password must be a string.");
  }

  return input.normalize("NFC");
}

export function countPasswordCodePoints(input: string): number {
  return [...normalizePassword(input)].length;
}

function containsCanonicalPassword(
  passwords: ReadonlySet<string>,
  canonicalCandidate: string,
): boolean {
  for (const password of passwords) {
    if (normalizePassword(password).toLowerCase() === canonicalCandidate) {
      return true;
    }
  }

  return false;
}

export function assertPasswordPolicy(input: string, options: PasswordPolicyOptions = {}): string {
  const normalized = normalizePassword(input);

  if ([...normalized].length < MIN_PASSWORD_CODE_POINTS) {
    throw new PasswordPolicyError("too_short");
  }

  const canonicalCandidate = normalized.toLowerCase();

  if (
    DEFAULT_COMMON_PASSWORDS.has(canonicalCandidate) ||
    (options.commonPasswords &&
      containsCanonicalPassword(options.commonPasswords, canonicalCandidate))
  ) {
    throw new PasswordPolicyError("common_password");
  }

  return normalized;
}
