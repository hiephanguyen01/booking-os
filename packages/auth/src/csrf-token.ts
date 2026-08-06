import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CSRF_NONCE_BYTES = 24;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface DeriveCsrfTokenInput {
  readonly csrfKey: Uint8Array;
  readonly sessionId: string;
  readonly hostname: string;
  readonly nonce: string;
}

export interface VerifyCsrfTokenInput {
  readonly csrfKey: Uint8Array;
  readonly sessionId: string;
  readonly hostname: string;
  readonly token: string;
}

function assertCsrfKey(csrfKey: Uint8Array): void {
  if (csrfKey.byteLength < 32) {
    throw new RangeError("CSRF keys must contain at least 32 bytes.");
  }
}

function assertBindingValue(value: string, label: string): void {
  if (value.length === 0 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be a non-empty canonical value.`);
  }
}

function assertNonce(nonce: string): void {
  if (!BASE64URL_PATTERN.test(nonce) || nonce.length < 16 || nonce.length > 128) {
    throw new TypeError("CSRF nonces must be canonical base64url values.");
  }
}

function updateField(hmac: ReturnType<typeof createHmac>, value: string): void {
  const byteLength = Buffer.byteLength(value, "utf8");
  hmac.update(String(byteLength), "utf8");
  hmac.update(":", "utf8");
  hmac.update(value, "utf8");
  hmac.update("\n", "utf8");
}

export function createCsrfNonce(
  entropy: (size: number) => Uint8Array = (size) => randomBytes(size),
): string {
  const bytes = entropy(CSRF_NONCE_BYTES);
  if (bytes.byteLength !== CSRF_NONCE_BYTES) {
    throw new RangeError(`CSRF nonce entropy must contain exactly ${String(CSRF_NONCE_BYTES)} bytes.`);
  }
  return Buffer.from(bytes).toString("base64url");
}

export function deriveCsrfToken(input: DeriveCsrfTokenInput): string {
  assertCsrfKey(input.csrfKey);
  assertBindingValue(input.sessionId, "Session ID");
  assertBindingValue(input.hostname, "Hostname");
  assertNonce(input.nonce);

  const hmac = createHmac("sha256", input.csrfKey);
  hmac.update("booking-os/csrf/v1\n", "utf8");
  updateField(hmac, input.sessionId);
  updateField(hmac, input.hostname);
  updateField(hmac, input.nonce);

  return `${input.nonce}.${hmac.digest("base64url")}`;
}

export function verifyCsrfToken(input: VerifyCsrfTokenInput): boolean {
  const separator = input.token.indexOf(".");
  if (separator <= 0 || separator !== input.token.lastIndexOf(".")) {
    return false;
  }

  const nonce = input.token.slice(0, separator);
  const presentedDigest = input.token.slice(separator + 1);
  if (!BASE64URL_PATTERN.test(presentedDigest)) {
    return false;
  }

  let expectedToken: string;
  try {
    expectedToken = deriveCsrfToken({
      csrfKey: input.csrfKey,
      sessionId: input.sessionId,
      hostname: input.hostname,
      nonce,
    });
  } catch {
    return false;
  }

  const expectedDigest = expectedToken.slice(expectedToken.indexOf(".") + 1);
  const presentedBytes = Buffer.from(presentedDigest, "base64url");
  const expectedBytes = Buffer.from(expectedDigest, "base64url");

  return presentedBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(presentedBytes, expectedBytes);
}
