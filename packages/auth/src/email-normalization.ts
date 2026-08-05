export function normalizeEmail(input: string): string {
  if (typeof input !== "string") {
    throw new TypeError("Email must be a string.");
  }

  const normalized = input.trim().normalize("NFC").toLowerCase();

  if (normalized.length === 0) {
    throw new TypeError("Email cannot be empty.");
  }

  return normalized;
}
