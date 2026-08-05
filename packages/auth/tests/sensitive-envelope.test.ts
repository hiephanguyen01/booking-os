import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptSensitiveEnvelope,
  encryptSensitiveEnvelope,
  SensitiveEnvelopeError,
} from "../src/sensitive-envelope.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KEY_V1 = new Uint8Array(32).fill(11);
const KEY_V2 = new Uint8Array(32).fill(22);
const AAD = encoder.encode("identity.activation.requested.v1:tenant.example.com");

function fixedIv(size: number): Uint8Array {
  assert.equal(size, 12);
  return Uint8Array.from({ length: size }, (_, index) => index + 1);
}

function tamperBase64Url(value: string): string {
  const replacement = value.startsWith("A") ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}

test("encrypts and decrypts an AES-256-GCM envelope with bound AAD", () => {
  const plaintext = encoder.encode('{"recipient":"owner@example.com","token":"secret"}');
  const envelope = encryptSensitiveEnvelope({
    keyId: "identity-v1",
    key: KEY_V1,
    plaintext,
    aad: AAD,
    randomBytes: fixedIv,
  });

  assert.deepEqual(envelope, {
    version: 1,
    keyId: "identity-v1",
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
    tag: envelope.tag,
  });
  assert.equal(envelope.iv.length, 16);
  assert.equal(envelope.ciphertext.includes("owner@example.com"), false);
  assert.equal(envelope.ciphertext.includes("secret"), false);
  assert.equal(envelope.tag.length, 22);

  const decrypted = decryptSensitiveEnvelope({
    envelope,
    keyring: { "identity-v1": KEY_V1 },
    aad: AAD,
  });

  assert.equal(decoder.decode(decrypted), decoder.decode(plaintext));
});

test("selects decryption keys by key ID for key rotation", () => {
  const envelope = encryptSensitiveEnvelope({
    keyId: "identity-v2",
    key: KEY_V2,
    plaintext: encoder.encode("rotated-key-payload"),
    aad: AAD,
    randomBytes: fixedIv,
  });

  const decrypted = decryptSensitiveEnvelope({
    envelope,
    keyring: {
      "identity-v1": KEY_V1,
      "identity-v2": KEY_V2,
    },
    aad: AAD,
  });

  assert.equal(decoder.decode(decrypted), "rotated-key-payload");
});

test("rejects wrong AAD, unknown keys, and tampering with a generic error", () => {
  const envelope = encryptSensitiveEnvelope({
    keyId: "identity-v1",
    key: KEY_V1,
    plaintext: encoder.encode("sensitive"),
    aad: AAD,
    randomBytes: fixedIv,
  });

  const attempts = [
    () =>
      decryptSensitiveEnvelope({
        envelope,
        keyring: { "identity-v1": KEY_V1 },
        aad: encoder.encode("different-context"),
      }),
    () => decryptSensitiveEnvelope({ envelope, keyring: {}, aad: AAD }),
    () =>
      decryptSensitiveEnvelope({
        envelope: { ...envelope, ciphertext: tamperBase64Url(envelope.ciphertext) },
        keyring: { "identity-v1": KEY_V1 },
        aad: AAD,
      }),
    () =>
      decryptSensitiveEnvelope({
        envelope: { ...envelope, tag: tamperBase64Url(envelope.tag) },
        keyring: { "identity-v1": KEY_V1 },
        aad: AAD,
      }),
  ];

  for (const attempt of attempts) {
    assert.throws(attempt, (error: unknown) => {
      assert.ok(error instanceof SensitiveEnvelopeError);
      assert.equal(error.message, "Sensitive envelope authentication failed.");
      return true;
    });
  }
});

test("requires a 32-byte key, non-empty key ID, and non-empty AAD", () => {
  const plaintext = encoder.encode("payload");

  assert.throws(
    () =>
      encryptSensitiveEnvelope({
        keyId: "identity-v1",
        key: new Uint8Array(31),
        plaintext,
        aad: AAD,
      }),
    RangeError,
  );
  assert.throws(
    () => encryptSensitiveEnvelope({ keyId: "", key: KEY_V1, plaintext, aad: AAD }),
    TypeError,
  );
  assert.throws(
    () =>
      encryptSensitiveEnvelope({
        keyId: "identity-v1",
        key: KEY_V1,
        plaintext,
        aad: new Uint8Array(),
      }),
    TypeError,
  );
});
