import { createHmac, randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";

export const PRE_AUTH_CSRF_COOKIE_NAME = "__Host-booking_pre_auth_csrf" as const;

const CSRF_VERSION = "v1" as const;
const CSRF_TTL_MS = (15 * 60 * 1000) as 900_000;
const NONCE_BYTES = 32;
const MINIMUM_SECRET_BYTES = 32;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export type PreAuthCsrfPurpose = "activation" | "password_forgot" | "password_reset";

export interface PreAuthCsrfCookieOptions {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: "strict";
  readonly path: "/";
  readonly maxAge: 900_000;
}

export interface IssuedPreAuthCsrf {
  readonly token: string;
  readonly expiresAt: Date;
  readonly cookie: {
    readonly name: typeof PRE_AUTH_CSRF_COOKIE_NAME;
    readonly value: string;
    readonly options: PreAuthCsrfCookieOptions;
  };
}

export interface PreAuthCsrfServiceOptions {
  readonly secret: Uint8Array;
  readonly now?: () => Date;
  readonly randomBytes?: (size: number) => Uint8Array;
}

export interface IssuePreAuthCsrfInput {
  readonly hostname: string;
  readonly purpose: PreAuthCsrfPurpose;
}

export interface VerifyPreAuthCsrfInput extends IssuePreAuthCsrfInput {
  readonly nonce: string;
  readonly token: string;
}

function normalizeHostname(input: string): string {
  const hostname = input.trim().normalize("NFC").toLowerCase();
  if (hostname.length === 0) {
    throw new TypeError("Pre-auth CSRF hostname cannot be empty.");
  }
  return hostname;
}

function decodeCanonicalBase64Url(value: string, expectedBytes: number): Buffer | null {
  if (!BASE64URL_PATTERN.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== expectedBytes || decoded.toString("base64url") !== value) {
    return null;
  }
  return decoded;
}

function associatedData(
  nonce: string,
  hostname: string,
  purpose: PreAuthCsrfPurpose,
  issuedAtMs: number,
): string {
  return [CSRF_VERSION, nonce, hostname, purpose, String(issuedAtMs)].join("\u0000");
}

export class PreAuthCsrfService {
  private readonly secret: Buffer;
  private readonly now: () => Date;
  private readonly randomBytes: (size: number) => Uint8Array;

  constructor(options: PreAuthCsrfServiceOptions) {
    if (
      !(options.secret instanceof Uint8Array) ||
      options.secret.byteLength < MINIMUM_SECRET_BYTES
    ) {
      throw new RangeError("Pre-auth CSRF secret must contain at least 32 bytes.");
    }

    this.secret = Buffer.from(options.secret);
    this.now = options.now ?? (() => new Date());
    this.randomBytes = options.randomBytes ?? cryptoRandomBytes;
  }

  issue(input: IssuePreAuthCsrfInput): IssuedPreAuthCsrf {
    const hostname = normalizeHostname(input.hostname);
    const nonceBytes = this.randomBytes(NONCE_BYTES);
    if (!(nonceBytes instanceof Uint8Array) || nonceBytes.byteLength !== NONCE_BYTES) {
      throw new RangeError("Pre-auth CSRF random source must return exactly 32 bytes.");
    }

    const nonce = Buffer.from(nonceBytes).toString("base64url");
    const issuedAt = this.now();
    const issuedAtMs = issuedAt.getTime();
    if (!Number.isSafeInteger(issuedAtMs)) {
      throw new RangeError("Pre-auth CSRF clock returned an invalid date.");
    }

    const signature = createHmac("sha256", this.secret)
      .update(associatedData(nonce, hostname, input.purpose, issuedAtMs), "utf8")
      .digest("base64url");

    return Object.freeze({
      token: `${CSRF_VERSION}.${issuedAtMs}.${signature}`,
      expiresAt: new Date(issuedAtMs + CSRF_TTL_MS),
      cookie: Object.freeze({
        name: PRE_AUTH_CSRF_COOKIE_NAME,
        value: nonce,
        options: Object.freeze({
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          path: "/",
          maxAge: CSRF_TTL_MS,
        }),
      }),
    });
  }

  verify(input: VerifyPreAuthCsrfInput): boolean {
    try {
      const hostname = normalizeHostname(input.hostname);
      const nonce = decodeCanonicalBase64Url(input.nonce, NONCE_BYTES);
      if (!nonce) {
        return false;
      }

      const parts = input.token.split(".");
      if (parts.length !== 3 || parts[0] !== CSRF_VERSION) {
        return false;
      }

      const issuedAtText = parts[1] ?? "";
      if (!/^(?:0|[1-9][0-9]*)$/u.test(issuedAtText)) {
        return false;
      }
      const issuedAtMs = Number(issuedAtText);
      if (!Number.isSafeInteger(issuedAtMs)) {
        return false;
      }

      const elapsed = this.now().getTime() - issuedAtMs;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > CSRF_TTL_MS) {
        return false;
      }

      const providedSignature = decodeCanonicalBase64Url(parts[2] ?? "", 32);
      if (!providedSignature) {
        return false;
      }

      const expectedSignature = createHmac("sha256", this.secret)
        .update(associatedData(input.nonce, hostname, input.purpose, issuedAtMs), "utf8")
        .digest();

      return timingSafeEqual(providedSignature, expectedSignature);
    } catch {
      return false;
    }
  }
}
