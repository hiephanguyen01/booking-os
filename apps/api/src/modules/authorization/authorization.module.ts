import { Module } from "@nestjs/common";

import { RequestContextModule } from "../../common/request-context/request-context.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import type { TenantTransactionPort } from "../tenancy/application/ports/tenant-transaction.port.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { TENANT_TRANSACTION_PORT } from "../tenancy/tenancy.tokens.js";
import type { AuthorizationRepositoryPort } from "./application/ports/authorization-repository.port.js";
import type { SessionAuthorizationRefreshPort } from "./application/ports/session-authorization-refresh.port.js";
import { BuildAuthorizationContextUseCase } from "./application/use-cases/build-authorization-context.use-case.js";
import { GetCurrentAuthorizationUseCase } from "./application/use-cases/get-current-authorization.use-case.js";
import { ReconcileAuthorizationVersionUseCase } from "./application/use-cases/reconcile-authorization-version.use-case.js";
import { ArchiveTenantCustomRoleUseCase } from "./application/use-cases/tenant-rbac/archive-tenant-custom-role.use-case.js";
import { CreateTenantCustomRoleUseCase } from "./application/use-cases/tenant-rbac/create-tenant-custom-role.use-case.js";
import { GetTenantCustomRoleUseCase } from "./application/use-cases/tenant-rbac/get-tenant-custom-role.use-case.js";
import { GrantMembershipCustomRoleUseCase } from "./application/use-cases/tenant-rbac/grant-membership-custom-role.use-case.js";
import { ListMembershipCustomRolesUseCase } from "./application/use-cases/tenant-rbac/list-membership-custom-roles.use-case.js";
import { ListTenantCustomRolesUseCase } from "./application/use-cases/tenant-rbac/list-tenant-custom-roles.use-case.js";
import { ListTenantPermissionsUseCase } from "./application/use-cases/tenant-rbac/list-tenant-permissions.use-case.js";
import { ReplaceTenantCustomRolePermissionsUseCase } from "./application/use-cases/tenant-rbac/replace-tenant-custom-role-permissions.use-case.js";
import { RevokeMembershipCustomRoleUseCase } from "./application/use-cases/tenant-rbac/revoke-membership-custom-role.use-case.js";
import { UpdateTenantCustomRoleUseCase } from "./application/use-cases/tenant-rbac/update-tenant-custom-role.use-case.js";
import {
  AUTHORIZATION_REPOSITORY_PORT,
  AUTHORIZATION_SECURITY_AUDIT_PORT,
  PROTECTED_REQUEST_AUTHORIZATION_PORT,
  SESSION_AUTHORIZATION_REFRESH_PORT,
} from "./authorization.tokens.js";
import { AuthorizationController } from "./infrastructure/http/authorization.controller.js";
import { PermissionGuard } from "./infrastructure/http/permission.guard.js";
import { TenantRbacController } from "./infrastructure/http/tenant-rbac.controller.js";
import { PrismaAuthorizationRepositoryAdapter } from "./infrastructure/persistence/prisma/prisma-authorization-repository.adapter.js";
import { PrismaAuthorizationSecurityAuditAdapter } from "./infrastructure/persistence/prisma/prisma-authorization-security-audit.adapter.js";
import { PrismaSessionAuthorizationRefreshAdapter } from "./infrastructure/persistence/prisma/prisma-session-authorization-refresh.adapter.js";

@Module({
  imports: [DatabaseModule, RequestContextModule, TenancyModule],
  controllers: [AuthorizationController, TenantRbacController],
  providers: [
    {
      provide: AUTHORIZATION_REPOSITORY_PORT,
      useClass: PrismaAuthorizationRepositoryAdapter,
    },
    {
      provide: AUTHORIZATION_SECURITY_AUDIT_PORT,
      useClass: PrismaAuthorizationSecurityAuditAdapter,
    },
    {
      provide: BuildAuthorizationContextUseCase,
      inject: [AUTHORIZATION_REPOSITORY_PORT],
      useFactory: (repository: AuthorizationRepositoryPort): BuildAuthorizationContextUseCase =>
        new BuildAuthorizationContextUseCase(repository),
    },
    {
      provide: SESSION_AUTHORIZATION_REFRESH_PORT,
      useClass: PrismaSessionAuthorizationRefreshAdapter,
    },
    {
      provide: ReconcileAuthorizationVersionUseCase,
      inject: [BuildAuthorizationContextUseCase, SESSION_AUTHORIZATION_REFRESH_PORT],
      useFactory: (
        build: BuildAuthorizationContextUseCase,
        sessions: SessionAuthorizationRefreshPort,
      ): ReconcileAuthorizationVersionUseCase =>
        new ReconcileAuthorizationVersionUseCase(build, sessions),
    },
    {
      provide: GetCurrentAuthorizationUseCase,
      inject: [ReconcileAuthorizationVersionUseCase],
      useFactory: (
        authorization: ReconcileAuthorizationVersionUseCase,
      ): GetCurrentAuthorizationUseCase => new GetCurrentAuthorizationUseCase(authorization),
    },
    {
      provide: ListTenantPermissionsUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): ListTenantPermissionsUseCase =>
        new ListTenantPermissionsUseCase(transactions),
    },
    {
      provide: ListTenantCustomRolesUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): ListTenantCustomRolesUseCase =>
        new ListTenantCustomRolesUseCase(transactions),
    },
    {
      provide: GetTenantCustomRoleUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): GetTenantCustomRoleUseCase =>
        new GetTenantCustomRoleUseCase(transactions),
    },
    {
      provide: CreateTenantCustomRoleUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): CreateTenantCustomRoleUseCase =>
        new CreateTenantCustomRoleUseCase(transactions),
    },
    {
      provide: UpdateTenantCustomRoleUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): UpdateTenantCustomRoleUseCase =>
        new UpdateTenantCustomRoleUseCase(transactions),
    },
    {
      provide: ReplaceTenantCustomRolePermissionsUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (
        transactions: TenantTransactionPort,
      ): ReplaceTenantCustomRolePermissionsUseCase =>
        new ReplaceTenantCustomRolePermissionsUseCase(transactions),
    },
    {
      provide: ArchiveTenantCustomRoleUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): ArchiveTenantCustomRoleUseCase =>
        new ArchiveTenantCustomRoleUseCase(transactions),
    },
    {
      provide: ListMembershipCustomRolesUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): ListMembershipCustomRolesUseCase =>
        new ListMembershipCustomRolesUseCase(transactions),
    },
    {
      provide: GrantMembershipCustomRoleUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): GrantMembershipCustomRoleUseCase =>
        new GrantMembershipCustomRoleUseCase(transactions),
    },
    {
      provide: RevokeMembershipCustomRoleUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): RevokeMembershipCustomRoleUseCase =>
        new RevokeMembershipCustomRoleUseCase(transactions),
    },
    {
      provide: PROTECTED_REQUEST_AUTHORIZATION_PORT,
      useExisting: ReconcileAuthorizationVersionUseCase,
    },
    PermissionGuard,
  ],
  exports: [
    AUTHORIZATION_REPOSITORY_PORT,
    AUTHORIZATION_SECURITY_AUDIT_PORT,
    PROTECTED_REQUEST_AUTHORIZATION_PORT,
    BuildAuthorizationContextUseCase,
    GetCurrentAuthorizationUseCase,
    ReconcileAuthorizationVersionUseCase,
    PermissionGuard,
  ],
})
export class AuthorizationModule {}
