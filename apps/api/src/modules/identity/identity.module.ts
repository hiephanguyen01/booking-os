import { Module } from "@nestjs/common";

import { EnvironmentService } from "../../config/environment.service.js";
import { DatabaseModule } from "../../database/database.module.js";
import { OutboxRepository } from "../../reliability/outbox.repository.js";
import type { ClockPort } from "./application/ports/clock.port.js";
import type { OneTimeTokenPort } from "./application/ports/one-time-token.port.js";
import type { SensitiveEnvelopePort } from "./application/ports/sensitive-envelope.port.js";
import {
  CLOCK_PORT,
  IDENTITY_OUTBOX_PORT,
  IDENTITY_REPOSITORY_PORT,
  ONE_TIME_TOKEN_PORT,
  PASSWORD_HASHER_PORT,
  SENSITIVE_ENVELOPE_PORT,
} from "./identity.tokens.js";
import { AesSensitiveEnvelopeAdapter } from "./infrastructure/crypto/aes-sensitive-envelope.adapter.js";
import { Argon2PasswordHasherAdapter } from "./infrastructure/crypto/argon2-password-hasher.adapter.js";
import { HmacOneTimeTokenAdapter } from "./infrastructure/crypto/hmac-one-time-token.adapter.js";
import { PrismaIdentityOutboxAdapter } from "./infrastructure/persistence/prisma/prisma-identity-outbox.adapter.js";
import { PrismaIdentityRepositoryAdapter } from "./infrastructure/persistence/prisma/prisma-identity-repository.adapter.js";

const systemClock: ClockPort = Object.freeze({
  now: (): Date => new Date(),
});

@Module({
  imports: [DatabaseModule],
  providers: [
    OutboxRepository,
    {
      provide: IDENTITY_REPOSITORY_PORT,
      useClass: PrismaIdentityRepositoryAdapter,
    },
    {
      provide: IDENTITY_OUTBOX_PORT,
      useClass: PrismaIdentityOutboxAdapter,
    },
    {
      provide: PASSWORD_HASHER_PORT,
      useClass: Argon2PasswordHasherAdapter,
    },
    {
      provide: ONE_TIME_TOKEN_PORT,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): OneTimeTokenPort =>
        new HmacOneTimeTokenAdapter(environment.identitySecurity.tokenPepper),
    },
    {
      provide: SENSITIVE_ENVELOPE_PORT,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): SensitiveEnvelopePort => {
        const security = environment.identitySecurity;
        return new AesSensitiveEnvelopeAdapter(security.activeEnvelopeKeyId, security.envelopeKeys);
      },
    },
    {
      provide: CLOCK_PORT,
      useValue: systemClock,
    },
  ],
  exports: [
    IDENTITY_REPOSITORY_PORT,
    IDENTITY_OUTBOX_PORT,
    PASSWORD_HASHER_PORT,
    ONE_TIME_TOKEN_PORT,
    SENSITIVE_ENVELOPE_PORT,
    CLOCK_PORT,
  ],
})
export class IdentityModule {}
