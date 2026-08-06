import { createHash } from "node:crypto";

import { Module } from "@nestjs/common";

import { EnvironmentService } from "../../config/environment.service.js";
import { DatabaseModule } from "../../database/database.module.js";
import type { SessionSecurityAuditPort } from "./application/ports/security-audit.port.js";
import type { SessionRepositoryPort } from "./application/ports/session-repository.port.js";
import { CreateSessionUseCase } from "./application/use-cases/create-session.js";
import { RefreshSessionUseCase } from "./application/use-cases/refresh-session.js";
import { RevokeSessionUseCase } from "./application/use-cases/revoke-session.js";
import { ValidateSessionUseCase } from "./application/use-cases/validate-session.js";
import { PrismaSessionRepositoryAdapter } from "./infrastructure/persistence/prisma/prisma-session-repository.adapter.js";
import { PrismaSessionSecurityAuditAdapter } from "./infrastructure/persistence/prisma/prisma-session-security-audit.adapter.js";
import {
  SESSION_DIGEST_KEY,
  SESSION_REPOSITORY_PORT,
  SESSION_SECURITY_AUDIT_PORT,
} from "./sessions.tokens.js";

function deriveSessionDigestKey(secret: string): Uint8Array {
  return createHash("sha256")
    .update("booking-os/session-token-digest/v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

@Module({
  imports: [DatabaseModule],
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
      provide: SESSION_DIGEST_KEY,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): Uint8Array =>
        deriveSessionDigestKey(environment.sessionSecret),
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
  ],
  exports: [
    SESSION_REPOSITORY_PORT,
    CreateSessionUseCase,
    ValidateSessionUseCase,
    RefreshSessionUseCase,
    RevokeSessionUseCase,
  ],
})
export class SessionsModule {}
