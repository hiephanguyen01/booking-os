import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_SELECTOR_BYTES = 18;
export const SESSION_SECRET_BYTES = 32;
export const SESSION_SECRET_DIGEST_HEX_LENGTH = 64;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface ParsedSessionToken {
  readonly selector: string;
  readonly secret: string;
}

export interface CreateSessionTokenOptions {
  readonly randomBytes?: (size: number) => Uint8Array;
}

export interface SessionSecretDigestInput {
  readonly digestKey: Uint8Array;
  readonly secret: string;
}

export interface VerifySessionSecretDigestInput extends SessionSecretDigestInput {
  readonly expectedDigest: string;
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function assertRandomBytes(bytes: Uint8Array, expectedLength: number, label: string): void {
  if (bytes.byteLength !== expectedLength) {
    throw new RangeError(`${label} entropy must contain exactly ${String(expectedLength)} bytes.`);
  }
}

function assertDigestKey(digestKey: Uint8Array): void {
  if (digestKey.byteLength < 32) {
    throw new RangeError("Session digest keys must contain at least 32 bytes.");
  }
}

function isCanonicalBase64Url(value: string, expectedBytes: number): boolean {
  if (!BASE64URL_PATTERN.test(value)) {
    return false;
  }

  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.byteLength === expectedBytes && decoded.toString("base64url") === value;
  } catch {
    return false;
  }
}

export function createSessionToken(options: CreateSessionTokenOptions = {}): string {
  const entropy = options.randomBytes ?? ((size: number): Uint8Array => randomBytes(size));
  const selectorBytes = entropy(SESSION_SELECTOR_BYTES);
  const secretBytes = entropy(SESSION_SECRET_BYTES);

  assertRandomBytes(selectorBytes, SESSION_SELECTOR_BYTES, "Session selector");
  assertRandomBytes(secretBytes, SESSION_SECRET_BYTES, "Session secret");

  return `${encodeBase64Url(selectorBytes)}.${encodeBase64Url(secretBytes)}`;
}

export function parseSessionToken(token: string): ParsedSessionToken | null {
  if (token.length === 0 || token.trim() !== token) {
    return null;
  }

  const separator = token.indexOf(".");
  if (separator <= 0 || separator !== token.lastIndexOf(".")) {
    return null;
  }

  const selector = token.slice(0, separator);
  const secret = token.slice(separator + 1);

  if (
    !isCanonicalBase64Url(selector, SESSION_SELECTOR_BYTES) ||
    !isCanonicalBase64Url(secret, SESSION_SECRET_BYTES)
  ) {
    return null;
  }

  return { selector, secret };
}

export function deriveSessionSecretDigest(input: SessionSecretDigestInput): string {
  assertDigestKey(input.digestKey);

  if (!isCanonicalBase64Url(input.secret, SESSION_SECRET_BYTES)) {
    throw new TypeError("Session secrets must be canonical base64url values with 32 bytes of entropy.");
  }

  return createHmac("sha256", input.digestKey).update(input.secret, "utf8").digest("hex");
}

export function verifySessionSecretDigest(input: VerifySessionSecretDigestInput): boolean {
  if (!HEX_SHA256_PATTERN.test(input.expectedDigest)) {
    return false;
  }

  let actualDigest: string;
  try {
    actualDigest = deriveSessionSecretDigest(input);
  } catch {
    return false;
  }

  return timingSafeEqual(Buffer.from(actualDigest, "hex"), Buffer.from(input.expectedDigest, "hex"));
}
