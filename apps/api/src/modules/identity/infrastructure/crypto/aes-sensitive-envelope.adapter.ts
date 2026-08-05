import {
  decryptSensitiveEnvelope,
  encryptSensitiveEnvelope,
  type SensitiveEnvelope,
} from "@booking-os/auth";

import type {
  SensitiveEnvelopePort,
  SensitiveEnvelopeValue,
} from "../../application/ports/sensitive-envelope.port.js";

export class AesSensitiveEnvelopeAdapter implements SensitiveEnvelopePort {
  private readonly activeKeyId: string;
  private readonly keyring: Readonly<Record<string, Uint8Array>>;

  constructor(activeKeyId: string, keyring: Readonly<Record<string, Uint8Array>>) {
    const copiedKeyring = Object.fromEntries(
      Object.entries(keyring).map(([keyId, key]) => [keyId, Buffer.from(key)]),
    );

    if (!Object.hasOwn(copiedKeyring, activeKeyId)) {
      throw new Error("The active sensitive-envelope key is unavailable.");
    }

    this.activeKeyId = activeKeyId;
    this.keyring = Object.freeze(copiedKeyring);
  }

  seal(plaintext: Uint8Array, associatedData: Uint8Array): SensitiveEnvelopeValue {
    const key = this.keyring[this.activeKeyId];

    if (!key) {
      throw new Error("The active sensitive-envelope key is unavailable.");
    }

    return encryptSensitiveEnvelope({
      keyId: this.activeKeyId,
      key,
      plaintext,
      aad: associatedData,
    });
  }

  open(envelope: SensitiveEnvelopeValue, associatedData: Uint8Array): Uint8Array {
    return decryptSensitiveEnvelope({
      envelope: envelope as SensitiveEnvelope,
      keyring: this.keyring,
      aad: associatedData,
    });
  }
}
