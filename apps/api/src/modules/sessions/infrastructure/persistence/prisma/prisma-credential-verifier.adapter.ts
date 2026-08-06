import { randomBytes } from "node:crypto";

import { ARGON2ID_BASELINE } from "@booking-os/auth";
import { Inject, Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  CredentialUserStatus,
  CredentialVerifierPort,
  RehashPasswordInput,
  VerifiedCredential,
  VerifyCredentialInput,
} from "../../../application/ports/credential-verifier.port.js";

function userStatus(
  status: "pendingActivation" | "active" | "suspended" | "disabled",
): CredentialUserStatus {
  return status === "pendingActivation" ? "pending_activation" : status;
}

function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, {
      version: ARGON2ID_BASELINE.version,
      memoryCost: ARGON2ID_BASELINE.memoryCostKiB,
      timeCost: ARGON2ID_BASELINE.timeCost,
      parallelism: ARGON2ID_BASELINE.parallelism,
    });
  } catch {
    return true;
  }
}

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    version: ARGON2ID_BASELINE.version,
    memoryCost: ARGON2ID_BASELINE.memoryCostKiB,
    timeCost: ARGON2ID_BASELINE.timeCost,
    parallelism: ARGON2ID_BASELINE.parallelism,
    hashLength: ARGON2ID_BASELINE.hashLength,
    salt: randomBytes(ARGON2ID_BASELINE.saltLength),
  });
}

@Injectable()
export class PrismaCredentialVerifierAdapter implements CredentialVerifierPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async verify(input: VerifyCredentialInput): Promise<VerifiedCredential | null> {
    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail: input.normalizedEmail },
      select: {
        id: true,
        status: true,
        passwordCredential: {
          select: { passwordHash: true },
        },
      },
    });
    const hash = user?.passwordCredential?.passwordHash;
    if (!user || !hash) {
      return null;
    }

    let verified = false;
    try {
      verified = await argon2.verify(hash, input.password);
    } catch {
      return null;
    }
    if (!verified) {
      return null;
    }

    return {
      userId: user.id,
      status: userStatus(user.status),
      passwordNeedsRehash: needsRehash(hash),
    };
  }

  async rehashPassword(input: RehashPasswordInput): Promise<void> {
    const passwordHash = await hashPassword(input.password);
    await this.prisma.passwordCredential.update({
      where: { userId: input.userId },
      data: {
        passwordHash,
        algorithm: "argon2id",
        parameters: {
          version: ARGON2ID_BASELINE.version,
          memoryCostKiB: ARGON2ID_BASELINE.memoryCostKiB,
          timeCost: ARGON2ID_BASELINE.timeCost,
          parallelism: ARGON2ID_BASELINE.parallelism,
          hashLength: ARGON2ID_BASELINE.hashLength,
          saltLength: ARGON2ID_BASELINE.saltLength,
        },
        passwordChangedAt: new Date(),
      },
    });
  }
}
