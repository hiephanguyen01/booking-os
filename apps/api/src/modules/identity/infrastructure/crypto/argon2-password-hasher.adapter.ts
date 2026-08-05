import { randomBytes } from "node:crypto";

import { ARGON2ID_BASELINE } from "@booking-os/auth";
import * as argon2 from "argon2";

import type { PasswordHasherPort } from "../../application/ports/password-hasher.port.js";

export interface Argon2PasswordHasherOptions {
  readonly version: number;
  readonly memoryCostKiB: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly hashLength: number;
  readonly saltLength: number;
}

const DEFAULT_OPTIONS: Argon2PasswordHasherOptions = Object.freeze({ ...ARGON2ID_BASELINE });

function validateOptions(options: Argon2PasswordHasherOptions): Argon2PasswordHasherOptions {
  const values = [
    options.version,
    options.memoryCostKiB,
    options.timeCost,
    options.parallelism,
    options.hashLength,
    options.saltLength,
  ];

  if (!values.every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError("Argon2id options must be positive safe integers.");
  }

  return Object.freeze({ ...options });
}

function decodedLength(value: string): number | null {
  if (!/^[A-Za-z0-9+/]+$/.test(value)) {
    return null;
  }

  try {
    return Buffer.from(value, "base64").byteLength;
  } catch {
    return null;
  }
}

export class Argon2PasswordHasherAdapter implements PasswordHasherPort {
  private readonly options: Argon2PasswordHasherOptions;

  constructor(options: Argon2PasswordHasherOptions = DEFAULT_OPTIONS) {
    this.options = validateOptions(options);
  }

  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      version: this.options.version,
      memoryCost: this.options.memoryCostKiB,
      timeCost: this.options.timeCost,
      parallelism: this.options.parallelism,
      hashLength: this.options.hashLength,
      salt: randomBytes(this.options.saltLength),
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    try {
      const fields = hash.split("$");
      const algorithm = fields[1];
      const salt = fields[4];
      const digest = fields[5];

      if (
        algorithm !== "argon2id" ||
        !salt ||
        !digest ||
        decodedLength(salt) !== this.options.saltLength ||
        decodedLength(digest) !== this.options.hashLength
      ) {
        return true;
      }

      return argon2.needsRehash(hash, {
        version: this.options.version,
        memoryCost: this.options.memoryCostKiB,
        timeCost: this.options.timeCost,
        parallelism: this.options.parallelism,
      });
    } catch {
      return true;
    }
  }
}
