import { createDecipheriv } from "node:crypto";

import { IdentityEmailDeliveryError } from "./identity-email-error.js";
import type { ParsedIdentityEmailEvent } from "./identity-email-event.js";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

function invalidEnvelope(): never {
  throw new IdentityEmailDeliveryError("identity_email.envelope_invalid", false);
}

function decodeBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    return invalidEnvelope();
  }

  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)
  ) {
    return invalidEnvelope();
  }
  return decoded;
}

function associatedData(event: ParsedIdentityEmailEvent): Buffer {
  return Buffer.from(
    [
      "booking-os:identity-email:v1",
      event.eventType,
      event.eventId,
      event.userId,
      event.hostname,
      event.recipient,
      event.template,
    ].join("\0"),
    "utf8",
  );
}

export function decryptIdentityEmailToken(
  event: ParsedIdentityEmailEvent,
  keyring: Readonly<Record<string, Uint8Array>>,
): string {
  let plaintext: Buffer | undefined;

  try {
    const key = Object.hasOwn(keyring, event.envelope.keyId)
      ? keyring[event.envelope.keyId]
      : undefined;
    if (!key || key.byteLength !== AES_KEY_BYTES) {
      return invalidEnvelope();
    }

    const iv = decodeBase64Url(event.envelope.iv, GCM_IV_BYTES);
    const ciphertext = decodeBase64Url(event.envelope.ciphertext);
    const tag = decodeBase64Url(event.envelope.tag, GCM_TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), iv, {
      authTagLength: GCM_TAG_BYTES,
    });
    decipher.setAAD(associatedData(event));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("token" in parsed) ||
      typeof parsed.token !== "string" ||
      !TOKEN_PATTERN.test(parsed.token)
    ) {
      return invalidEnvelope();
    }

    return parsed.token;
  } catch {
    return invalidEnvelope();
  } finally {
    plaintext?.fill(0);
  }
}
