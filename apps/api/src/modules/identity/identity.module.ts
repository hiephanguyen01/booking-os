import { Module } from "@nestjs/common";

import { EnvironmentService } from "../../config/environment.service.js";
import { DatabaseModule } from "../../database/database.module.js";
import { OutboxRepository } from "../../reliability/outbox.repository.js";
import type { ClockPort } from "./application/ports/clock.port.js";
import type { IdentityOutboxPort } from "./application/ports/identity-outbox.port.js";
import type { IdentityRepositoryPort } from "./application/ports/identity-repository.port.js";
import type { OneTimeTokenPort } from "./application/ports/one-time-token.port.js";
import type { PasswordDenylistPort } from "./application/ports/password-denylist.port.js";
import type { PasswordHasherPort } from "./application/ports/password-hasher.port.js";
import type { SecurityAuditPort } from "./application/ports/security-audit.port.js";
import type { SensitiveEnvelopePort } from "./application/ports/sensitive-envelope.port.js";
import { CompleteActivationUseCase } from "./application/use-cases/complete-activation.js";
import { CompletePasswordResetUseCase } from "./application/use-cases/complete-password-reset.js";
import { RequestPasswordResetUseCase } from "./application/use-cases/request-password-reset.js";
import {
  CLOCK_PORT,
  IDENTITY_OUTBOX_PORT,
  IDENTITY_REPOSITORY_PORT,
  ONE_TIME_TOKEN_PORT,
  PASSWORD_DENYLIST_PORT,
  PASSWORD_HASHER_PORT,
  SECURITY_AUDIT_PORT,
  SENSITIVE_ENVELOPE_PORT,
} from "./identity.tokens.js";
import { AesSensitiveEnvelopeAdapter } from "./infrastructure/crypto/aes-sensitive-envelope.adapter.js";
import { Argon2PasswordHasherAdapter } from "./infrastructure/crypto/argon2-password-hasher.adapter.js";
import { HmacOneTimeTokenAdapter } from "./infrastructure/crypto/hmac-one-time-token.adapter.js";
import { IdentityPublicController } from "./infrastructure/http/identity-public.controller.js";
import { NestIdentityPublicController } from "./infrastructure/http/identity-public.nest.controller.js";
import { IdentityPublicCsrfAdapter } from "./infrastructure/http/identity-public-csrf.adapter.js";
import { PreAuthCsrfService } from "./infrastructure/http/pre-auth-csrf.js";
import { PrismaIdentityOutboxAdapter } from "./infrastructure/persistence/prisma/prisma-identity-outbox.adapter.js";
import { PrismaIdentityRepositoryAdapter } from "./infrastructure/persistence/prisma/prisma-identity-repository.adapter.js";
import { PrismaSecurityAuditAdapter } from "./infrastructure/persistence/prisma/prisma-security-audit.adapter.js";

const systemClock: ClockPort = Object.freeze({
  now: (): Date => new Date(),
});

const externalPasswordDenylist: PasswordDenylistPort = Object.freeze({
  contains: async (): Promise<boolean> => false,
});

@Module({
  imports: [DatabaseModule],
  controllers: [NestIdentityPublicController],
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
      provide: PASSWORD_DENYLIST_PORT,
      useValue: externalPasswordDenylist,
    },
    {
      provide: SECURITY_AUDIT_PORT,
      useClass: PrismaSecurityAuditAdapter,
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
    {
      provide: PreAuthCsrfService,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): PreAuthCsrfService =>
        new PreAuthCsrfService({
          secret: new TextEncoder().encode(environment.sessionSecret),
        }),
    },
    {
      provide: IdentityPublicCsrfAdapter,
      inject: [PreAuthCsrfService],
      useFactory: (csrf: PreAuthCsrfService): IdentityPublicCsrfAdapter =>
        new IdentityPublicCsrfAdapter(csrf),
    },
    {
      provide: CompleteActivationUseCase,
      inject: [
        IDENTITY_REPOSITORY_PORT,
        ONE_TIME_TOKEN_PORT,
        PASSWORD_HASHER_PORT,
        PASSWORD_DENYLIST_PORT,
        CLOCK_PORT,
      ],
      useFactory: (
        repository: IdentityRepositoryPort,
        tokens: OneTimeTokenPort,
        passwordHasher: PasswordHasherPort,
        passwordDenylist: PasswordDenylistPort,
        clock: ClockPort,
      ): CompleteActivationUseCase =>
        new CompleteActivationUseCase(repository, tokens, passwordHasher, passwordDenylist, clock),
    },
    {
      provide: RequestPasswordResetUseCase,
      inject: [
        IDENTITY_REPOSITORY_PORT,
        IDENTITY_OUTBOX_PORT,
        ONE_TIME_TOKEN_PORT,
        SENSITIVE_ENVELOPE_PORT,
        SECURITY_AUDIT_PORT,
        CLOCK_PORT,
      ],
      useFactory: (
        repository: IdentityRepositoryPort,
        outbox: IdentityOutboxPort,
        tokens: OneTimeTokenPort,
        envelope: SensitiveEnvelopePort,
        audit: SecurityAuditPort,
        clock: ClockPort,
      ): RequestPasswordResetUseCase =>
        new RequestPasswordResetUseCase(repository, outbox, tokens, envelope, audit, clock),
    },
    {
      provide: CompletePasswordResetUseCase,
      inject: [
        IDENTITY_REPOSITORY_PORT,
        ONE_TIME_TOKEN_PORT,
        PASSWORD_HASHER_PORT,
        PASSWORD_DENYLIST_PORT,
        CLOCK_PORT,
      ],
      useFactory: (
        repository: IdentityRepositoryPort,
        tokens: OneTimeTokenPort,
        passwordHasher: PasswordHasherPort,
        passwordDenylist: PasswordDenylistPort,
        clock: ClockPort,
      ): CompletePasswordResetUseCase =>
        new CompletePasswordResetUseCase(repository, tokens, passwordHasher, passwordDenylist, clock),
    },
    {
      provide: IdentityPublicController,
      inject: [
        IdentityPublicCsrfAdapter,
        CompleteActivationUseCase,
        RequestPasswordResetUseCase,
        CompletePasswordResetUseCase,
      ],
      useFactory: (
        csrf: IdentityPublicCsrfAdapter,
        completeActivation: CompleteActivationUseCase,
        requestPasswordReset: RequestPasswordResetUseCase,
        completePasswordReset: CompletePasswordResetUseCase,
      ): IdentityPublicController =>
        new IdentityPublicController({
          csrf,
          completeActivation,
          requestPasswordReset,
          completePasswordReset,
        }),
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
