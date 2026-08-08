import { createHash } from "node:crypto";

import type { StructuredLogger } from "@booking-os/observability";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { RequestContextModule } from "../../common/request-context/request-context.module.js";
import { RequestContextStorage } from "../../common/request-context/request-context.storage.js";
import { EnvironmentService } from "../../config/environment.service.js";
import { DatabaseModule } from "../../database/database.module.js";
import { DependenciesModule } from "../../dependencies/dependencies.module.js";
import { REDIS_CLIENT_TOKEN } from "../../dependencies/tokens.js";
import { API_LOGGER_TOKEN } from "../../observability/tokens.js";
import type { CredentialVerifierPort } from "./application/ports/credential-verifier.port.js";
import type { LoginAbuseMetricsPort } from "./application/ports/login-abuse-metrics.port.js";
import type { LoginAbuseProtectionPort } from "./application/ports/login-abuse-protection.port.js";
import type { SessionSecurityAuditPort } from "./application/ports/security-audit.port.js";
import type { SessionRepositoryPort } from "./application/ports/session-repository.port.js";
import type { SessionSubjectPort } from "./application/ports/session-subject.port.js";
import { CreateSessionUseCase } from "./application/use-cases/create-session.js";
import { GetCurrentSessionUseCase } from "./application/use-cases/get-current-session.use-case.js";
import { ListSessionsUseCase } from "./application/use-cases/list-sessions.js";
import { LoginUseCase } from "./application/use-cases/login.use-case.js";
import { RefreshSessionUseCase } from "./application/use-cases/refresh-session.js";
import { RevokeOtherSessionsUseCase } from "./application/use-cases/revoke-other-sessions.js";
import { RevokeSessionUseCase } from "./application/use-cases/revoke-session.js";
import { ValidateSessionUseCase } from "./application/use-cases/validate-session.js";
import {
  type LoginAbuseRedisClient,
  RedisLoginAbuseProtectionAdapter,
} from "./infrastructure/abuse/redis-login-abuse-protection.adapter.js";
import { SessionAuthMiddleware } from "./infrastructure/http/session-auth.middleware.js";
import { SessionCsrfGuard } from "./infrastructure/http/session-csrf.guard.js";
import { SessionCsrfHttpController } from "./infrastructure/http/session-csrf-http.controller.js";
import { SessionHttpController } from "./infrastructure/http/session-http.controller.js";
import { SessionRequiredGuard } from "./infrastructure/http/session-required.guard.js";
import { StructuredLoginAbuseMetricsAdapter } from "./infrastructure/observability/structured-login-abuse-metrics.adapter.js";
import { PrismaCredentialVerifierAdapter } from "./infrastructure/persistence/prisma/prisma-credential-verifier.adapter.js";
import { PrismaSessionRepositoryAdapter } from "./infrastructure/persistence/prisma/prisma-session-repository.adapter.js";
import { PrismaSessionSecurityAuditAdapter } from "./infrastructure/persistence/prisma/prisma-session-security-audit.adapter.js";
import { PrismaSessionSubjectAdapter } from "./infrastructure/persistence/prisma/prisma-session-subject.adapter.js";
import {
  CREDENTIAL_VERIFIER_PORT,
  LOGIN_ABUSE_HMAC_KEY,
  LOGIN_ABUSE_METRICS_PORT,
  LOGIN_ABUSE_PROTECTION_PORT,
  SESSION_DIGEST_KEY,
  SESSION_REPOSITORY_PORT,
  SESSION_SECURITY_AUDIT_PORT,
  SESSION_SUBJECT_PORT,
} from "./sessions.tokens.js";

function deriveKey(purpose: string, secret: string): Uint8Array {
  return createHash("sha256").update(`${purpose}\0`, "utf8").update(secret, "utf8").digest();
}

@Module({
  imports: [DatabaseModule, DependenciesModule, RequestContextModule],
  controllers: [SessionHttpController, SessionCsrfHttpController],
  providers: [
    {
      provide: SESSION_REPOSITORY_PORT,
      useClass: PrismaSessionRepositoryAdapter,
    },
    {
      provide: SESSION_SECURITY_AUDIT_PORT,
      useClass: PrismaSessionSecurityAuditAdapter,
    },
    {
      provide: CREDENTIAL_VERIFIER_PORT,
      useClass: PrismaCredentialVerifierAdapter,
    },
    {
      provide: SESSION_SUBJECT_PORT,
      useClass: PrismaSessionSubjectAdapter,
    },
    {
      provide: SESSION_DIGEST_KEY,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): Uint8Array =>
        deriveKey("booking-os/session-token-digest/v1", environment.sessionSecret),
    },
    {
      provide: LOGIN_ABUSE_HMAC_KEY,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): Uint8Array =>
        deriveKey("booking-os/login-abuse-key/v1", environment.sessionSecret),
    },
    {
      provide: LOGIN_ABUSE_METRICS_PORT,
      inject: [API_LOGGER_TOKEN],
      useFactory: (logger: StructuredLogger): LoginAbuseMetricsPort =>
        new StructuredLoginAbuseMetricsAdapter(logger),
    },
    {
      provide: LOGIN_ABUSE_PROTECTION_PORT,
      inject: [REDIS_CLIENT_TOKEN, LOGIN_ABUSE_METRICS_PORT],
      useFactory: (
        redis: LoginAbuseRedisClient,
        metrics: LoginAbuseMetricsPort,
      ): LoginAbuseProtectionPort => new RedisLoginAbuseProtectionAdapter(redis, {}, metrics),
    },
    {
      provide: CreateSessionUseCase,
      inject: [SESSION_REPOSITORY_PORT, SESSION_SECURITY_AUDIT_PORT, SESSION_DIGEST_KEY],
      useFactory: (
        repository: SessionRepositoryPort,
        audit: SessionSecurityAuditPort,
        digestKey: Uint8Array,
      ): CreateSessionUseCase => new CreateSessionUseCase(repository, audit, { digestKey }),
    },
    {
      provide: ValidateSessionUseCase,
      inject: [SESSION_REPOSITORY_PORT, SESSION_SECURITY_AUDIT_PORT, SESSION_DIGEST_KEY],
      useFactory: (
        repository: SessionRepositoryPort,
        audit: SessionSecurityAuditPort,
        digestKey: Uint8Array,
      ): ValidateSessionUseCase => new ValidateSessionUseCase(repository, audit, { digestKey }),
    },
    {
      provide: RefreshSessionUseCase,
      inject: [SESSION_REPOSITORY_PORT, SESSION_SECURITY_AUDIT_PORT, SESSION_DIGEST_KEY],
      useFactory: (
        repository: SessionRepositoryPort,
        audit: SessionSecurityAuditPort,
        digestKey: Uint8Array,
      ): RefreshSessionUseCase => new RefreshSessionUseCase(repository, audit, { digestKey }),
    },
    {
      provide: RevokeSessionUseCase,
      inject: [SESSION_REPOSITORY_PORT, SESSION_SECURITY_AUDIT_PORT],
      useFactory: (
        repository: SessionRepositoryPort,
        audit: SessionSecurityAuditPort,
      ): RevokeSessionUseCase => new RevokeSessionUseCase(repository, audit),
    },
    {
      provide: ListSessionsUseCase,
      inject: [SESSION_REPOSITORY_PORT],
      useFactory: (repository: SessionRepositoryPort): ListSessionsUseCase =>
        new ListSessionsUseCase(repository),
    },
    {
      provide: RevokeOtherSessionsUseCase,
      inject: [SESSION_REPOSITORY_PORT, SESSION_SECURITY_AUDIT_PORT],
      useFactory: (
        repository: SessionRepositoryPort,
        audit: SessionSecurityAuditPort,
      ): RevokeOtherSessionsUseCase => new RevokeOtherSessionsUseCase(repository, audit),
    },
    {
      provide: LoginUseCase,
      inject: [
        CREDENTIAL_VERIFIER_PORT,
        SESSION_SUBJECT_PORT,
        LOGIN_ABUSE_PROTECTION_PORT,
        CreateSessionUseCase,
        LOGIN_ABUSE_HMAC_KEY,
      ],
      useFactory: (
        credentials: CredentialVerifierPort,
        subjects: SessionSubjectPort,
        abuse: LoginAbuseProtectionPort,
        sessions: CreateSessionUseCase,
        abuseHmacKey: Uint8Array,
      ): LoginUseCase => new LoginUseCase(credentials, subjects, abuse, sessions, { abuseHmacKey }),
    },
    {
      provide: GetCurrentSessionUseCase,
      inject: [SESSION_REPOSITORY_PORT, SESSION_SUBJECT_PORT, ValidateSessionUseCase],
      useFactory: (
        repository: SessionRepositoryPort,
        subjects: SessionSubjectPort,
        validator: ValidateSessionUseCase,
      ): GetCurrentSessionUseCase => new GetCurrentSessionUseCase(repository, subjects, validator),
    },
    {
      provide: SessionAuthMiddleware,
      inject: [GetCurrentSessionUseCase, RequestContextStorage, EnvironmentService],
      useFactory: (
        currentSession: GetCurrentSessionUseCase,
        requestContext: RequestContextStorage,
        environment: EnvironmentService,
      ): SessionAuthMiddleware =>
        new SessionAuthMiddleware(currentSession, requestContext, {
          trustProxy: environment.trustProxy,
        }),
    },
    SessionCsrfGuard,
    SessionRequiredGuard,
    {
      provide: APP_GUARD,
      useExisting: SessionRequiredGuard,
    },
  ],
  exports: [
    SESSION_REPOSITORY_PORT,
    LOGIN_ABUSE_PROTECTION_PORT,
    CreateSessionUseCase,
    ValidateSessionUseCase,
    RefreshSessionUseCase,
    RevokeSessionUseCase,
    ListSessionsUseCase,
    RevokeOtherSessionsUseCase,
    LoginUseCase,
    GetCurrentSessionUseCase,
    SessionAuthMiddleware,
    SessionCsrfGuard,
  ],
})
export class SessionsModule {}
