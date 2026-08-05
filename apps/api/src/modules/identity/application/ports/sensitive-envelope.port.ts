export interface SensitiveEnvelopeValue {
  readonly version: 1;
  readonly keyId: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

export interface SensitiveEnvelopePort {
  seal(plaintext: Uint8Array, associatedData: Uint8Array): SensitiveEnvelopeValue;
  open(envelope: SensitiveEnvelopeValue, associatedData: Uint8Array): Uint8Array;
}
