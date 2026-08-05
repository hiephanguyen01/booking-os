import {
  createCipheriv,
  createDecipheriv,
  randomBytes as cryptoRandomBytes,
} from "node:crypto";

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface SensitiveEnvelope {
  readonly version: 1;
  readonly keyId: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

export interface EncryptSensitiveEnvelopeOptions {
  readonly keyId: string;
  readonly key: Uint8Array;
  readonly plaintext: Uint8Array;
  readonly aad: Uint8Array;
  readonly randomBytes?: (size: number) => Uint8Array;
}

export interface DecryptSensitiveEnvelopeOptions {
  readonly envelope: SensitiveEnvelope;
  readonly keyring: Readonly<Record<string, Uint8Array>>;
  readonly aad: Uint8Array;
}

export class SensitiveEnvelopeError extends Error {
  constructor() {
    super("Sensitive envelope authentication failed.");
    this.name = "SensitiveEnvelopeError";
  }
}

function assertKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.byteLength !== AES_KEY_BYTES) {
    throw new RangeError("Sensitive envelope key must contain exactly 32 bytes.");
  }
}

function assertKeyId(keyId: string): string {
  if (typeof keyId !== "string" || keyId.trim().length === 0) {
    throw new TypeError("Sensitive envelope key ID cannot be empty.");
  }

  return keyId.trim();
}

function assertAad(aad: Uint8Array): void {
  if (!(aad instanceof Uint8Array) || aad.byteLength === 0) {
    throw new TypeError("Sensitive envelope AAD cannot be empty.");
  }
}

function drawIv(randomBytes: (size: number) => Uint8Array): Uint8Array {
  const iv = randomBytes(GCM_IV_BYTES);

  if (!(iv instanceof Uint8Array) || iv.byteLength !== GCM_IV_BYTES) {
    throw new RangeError("Random byte source must return exactly 12 bytes.");
  }

  return iv;
}

function decodeCanonicalBase64Url(value: string, expectedBytes?: number): Buffer {
  if (value.length === 0 || !BASE64URL_PATTERN.test(value)) {
    throw new SensitiveEnvelopeError();
  }

  const decoded = Buffer.from(value, "base64url");

  if (
    decoded.toString("base64url") !== value ||
    (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)
  ) {
    throw new SensitiveEnvelopeError();
  }

  return decoded;
}

export function encryptSensitiveEnvelope(
  options: EncryptSensitiveEnvelopeOptions,
): SensitiveEnvelope {
  const keyId = assertKeyId(options.keyId);
  assertKey(options.key);
  assertAad(options.aad);

  if (!(options.plaintext instanceof Uint8Array)) {
    throw new TypeError("Sensitive envelope plaintext must be bytes.");
  }

  const iv = drawIv(options.randomBytes ?? cryptoRandomBytes);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(options.key), Buffer.from(iv), {
    authTagLength: GCM_TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(options.aad));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(options.plaintext)),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Object.freeze({
    version: 1,
    keyId,
    iv: Buffer.from(iv).toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: tag.toString("base64url"),
  });
}

export function decryptSensitiveEnvelope(
  options: DecryptSensitiveEnvelopeOptions,
): Uint8Array {
  try {
    assertAad(options.aad);

    if (options.envelope.version !== 1) {
      throw new SensitiveEnvelopeError();
    }

    const keyId = assertKeyId(options.envelope.keyId);
    const key = Object.hasOwn(options.keyring, keyId) ? options.keyring[keyId] : undefined;

    if (!key) {
      throw new SensitiveEnvelopeError();
    }

    assertKey(key);
    const iv = decodeCanonicalBase64Url(options.envelope.iv, GCM_IV_BYTES);
    const ciphertext = decodeCanonicalBase64Url(options.envelope.ciphertext);
    const tag = decodeCanonicalBase64Url(options.envelope.tag, GCM_TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), iv, {
      authTagLength: GCM_TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(options.aad));
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new SensitiveEnvelopeError();
  }
}
