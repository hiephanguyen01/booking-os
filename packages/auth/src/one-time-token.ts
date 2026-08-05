import { createHmac, randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";

const SELECTOR_BYTES = 16;
const SECRET_BYTES = 32;
const MINIMUM_PEPPER_BYTES = 32;
const DIGEST_BYTES = 32;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEX_DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const DOMAIN_SEPARATOR = "booking-os:one-time-token:v1";

export interface OneTimeToken {
  readonly selector: string;
  readonly secret: string;
  readonly serialized: string;
  readonly secretDigest: string;
}

export interface ParsedOneTimeToken {
  readonly selector: string;
  readonly secret: string;
}

export interface CreateOneTimeTokenOptions {
  readonly pepper: Uint8Array;
  readonly purpose: string;
  readonly randomBytes?: (size: number) => Uint8Array;
}

export interface DeriveOneTimeTokenDigestOptions {
  readonly pepper: Uint8Array;
  readonly purpose: string;
  readonly secret: string;
}

export interface VerifyOneTimeTokenSecretOptions extends DeriveOneTimeTokenDigestOptions {
  readonly expectedDigest: string;
}

function assertPepper(pepper: Uint8Array): void {
  if (!(pepper instanceof Uint8Array) || pepper.byteLength < MINIMUM_PEPPER_BYTES) {
    throw new RangeError("One-time token pepper must contain at least 32 bytes.");
  }
}

function normalizePurpose(purpose: string): string {
  if (typeof purpose !== "string" || purpose.trim().length === 0) {
    throw new TypeError("One-time token purpose cannot be empty.");
  }

  return purpose.trim();
}

function drawBytes(size: number, randomBytes: (size: number) => Uint8Array): Uint8Array {
  const bytes = randomBytes(size);

  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) {
    throw new RangeError(`Random byte source must return exactly ${size} bytes.`);
  }

  return bytes;
}

function digestSecret(pepper: Uint8Array, purpose: string, secret: string): Buffer {
  return createHmac("sha256", Buffer.from(pepper))
    .update(DOMAIN_SEPARATOR, "utf8")
    .update("\0", "utf8")
    .update(purpose, "utf8")
    .update("\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

export function deriveOneTimeTokenDigest(options: DeriveOneTimeTokenDigestOptions): string {
  assertPepper(options.pepper);
  const purpose = normalizePurpose(options.purpose);

  if (typeof options.secret !== "string" || !BASE64URL_PATTERN.test(options.secret)) {
    throw new TypeError("One-time token secret is malformed.");
  }

  return digestSecret(options.pepper, purpose, options.secret).toString("hex");
}

export function createOneTimeToken(options: CreateOneTimeTokenOptions): OneTimeToken {
  assertPepper(options.pepper);
  const purpose = normalizePurpose(options.purpose);
  const randomBytes = options.randomBytes ?? cryptoRandomBytes;
  const selector = Buffer.from(drawBytes(SELECTOR_BYTES, randomBytes)).toString("base64url");
  const secret = Buffer.from(drawBytes(SECRET_BYTES, randomBytes)).toString("base64url");
  const secretDigest = digestSecret(options.pepper, purpose, secret).toString("hex");

  return Object.freeze({
    selector,
    secret,
    serialized: `${selector}.${secret}`,
    secretDigest,
  });
}

export function parseOneTimeToken(serialized: string): ParsedOneTimeToken | null {
  if (typeof serialized !== "string") {
    return null;
  }

  const separatorIndex = serialized.indexOf(".");

  if (separatorIndex <= 0 || separatorIndex !== serialized.lastIndexOf(".")) {
    return null;
  }

  const selector = serialized.slice(0, separatorIndex);
  const secret = serialized.slice(separatorIndex + 1);

  if (
    selector.length !== 22 ||
    secret.length !== 43 ||
    !BASE64URL_PATTERN.test(selector) ||
    !BASE64URL_PATTERN.test(secret)
  ) {
    return null;
  }

  return Object.freeze({ selector, secret });
}

export function verifyOneTimeTokenSecret(options: VerifyOneTimeTokenSecretOptions): boolean {
  if (!HEX_DIGEST_PATTERN.test(options.expectedDigest)) {
    return false;
  }

  try {
    const expected = Buffer.from(options.expectedDigest, "hex");

    if (expected.byteLength !== DIGEST_BYTES) {
      return false;
    }

    const actual = Buffer.from(deriveOneTimeTokenDigest(options), "hex");
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
