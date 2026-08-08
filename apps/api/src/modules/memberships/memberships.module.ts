import { Module } from "@nestjs/common";

import { SessionCsrfGuard } from "../../common/security/session-csrf.guard.js";
import { EnvironmentService } from "../../config/environment.service.js";
import { DatabaseModule } from "../../database/database.module.js";
import type { TenantTransactionPort } from "../tenancy/application/ports/tenant-transaction.port.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { TENANT_TRANSACTION_PORT } from "../tenancy/tenancy.tokens.js";
import type { MembershipInvitationEnvelopePort } from "./application/ports/membership-invitation-envelope.port.js";
import type { MembershipInvitationTokenPort } from "./application/ports/membership-invitation-token.port.js";
import type { PlatformAuthorizationPort } from "./application/ports/platform-authorization.port.js";
import type { PlatformTenantProvisioningTransactionPort } from "./application/ports/platform-tenant-provisioning-transaction.port.js";
import type { TenantActivationEnvelopePort } from "./application/ports/tenant-activation-envelope.port.js";
import type { TenantActivationTokenPort } from "./application/ports/tenant-activation-token.port.js";
import type { TenantAdminInvitationEnvelopePort } from "./application/ports/tenant-admin-invitation-envelope.port.js";
import {
  AcceptInvitationUseCase,
  type InvitationAcceptanceTokenPort,
} from "./application/use-cases/accept-invitation.use-case.js";
import { BuildPlatformAuthorizationContextUseCase } from "./application/use-cases/build-platform-authorization-context.use-case.js";
import { BuildTenantAuthorizationContextUseCase } from "./application/use-cases/build-tenant-authorization-context.use-case.js";
import { DemoteOwnerUseCase } from "./application/use-cases/demote-owner.use-case.js";
import { GetCurrentInvitationUseCase } from "./application/use-cases/get-current-invitation.use-case.js";
import { GetTenantProvisioningUseCase } from "./application/use-cases/get-tenant-provisioning.use-case.js";
import { InviteTenantAdminUseCase } from "./application/use-cases/invite-tenant-admin.use-case.js";
import { ListMembershipsUseCase } from "./application/use-cases/list-memberships.use-case.js";
import { PlatformTenantProvisioningWorkflow } from "./application/use-cases/platform-tenant-provisioning.workflow.js";
import { PromoteOwnerUseCase } from "./application/use-cases/promote-owner.use-case.js";
import { ProvisionTenantUseCase } from "./application/use-cases/provision-tenant.use-case.js";
import { ResendInvitationUseCase } from "./application/use-cases/resend-invitation.use-case.js";
import { ResendOwnerInvitationUseCase } from "./application/use-cases/resend-owner-invitation.use-case.js";
import { ResolvePendingInvitationLoginUseCase } from "./application/use-cases/resolve-pending-invitation-login.use-case.js";
import { RevokeMembershipUseCase } from "./application/use-cases/revoke-membership.use-case.js";
import { SuspendMembershipUseCase } from "./application/use-cases/suspend-membership.use-case.js";
import { TenantAdminInvitationWorkflow } from "./application/use-cases/tenant-admin-invitation.workflow.js";
import {
  AesMembershipInvitationEnvelopeAdapter,
  AesTenantActivationEnvelopeAdapter,
} from "./infrastructure/crypto/aes-membership-provisioning-envelope.adapter.js";
import { AesTenantAdminInvitationEnvelopeAdapter } from "./infrastructure/crypto/aes-tenant-admin-invitation-envelope.adapter.js";
import {
  HmacMembershipInvitationTokenAdapter,
  HmacTenantActivationTokenAdapter,
} from "./infrastructure/crypto/hmac-membership-provisioning-token.adapter.js";
import { PlatformTenantsController } from "./infrastructure/http/platform-tenants.controller.js";
import { TenantInvitationsController } from "./infrastructure/http/tenant-invitations.controller.js";
import { TenantMembershipsController } from "./infrastructure/http/tenant-memberships.controller.js";
import { PrismaPlatformAuthorizationAdapter } from "./infrastructure/persistence/prisma/prisma-platform-authorization.adapter.js";
import { PrismaPlatformTenantProvisioningQueryAdapter } from "./infrastructure/persistence/prisma/prisma-platform-tenant-provisioning-query.adapter.js";
import { PrismaPlatformTenantProvisioningTransactionAdapter } from "./infrastructure/persistence/prisma/prisma-platform-tenant-provisioning-transaction.adapter.js";
import {
  MEMBERSHIP_INVITATION_ENVELOPE_PORT,
  MEMBERSHIP_INVITATION_TOKEN_PORT,
  PLATFORM_AUTHORIZATION_PORT,
  PLATFORM_TENANT_PROVISIONING_TRANSACTION_PORT,
  TENANT_ACTIVATION_ENVELOPE_PORT,
  TENANT_ACTIVATION_TOKEN_PORT,
  TENANT_ADMIN_INVITATION_ENVELOPE_PORT,
} from "./memberships.tokens.js";

@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [PlatformTenantsController, TenantInvitationsController, TenantMembershipsController],
  providers: [
    SessionCsrfGuard,
    {
      provide: PLATFORM_AUTHORIZATION_PORT,
      useClass: PrismaPlatformAuthorizationAdapter,
    },
    {
      provide: PLATFORM_TENANT_PROVISIONING_TRANSACTION_PORT,
      useClass: PrismaPlatformTenantProvisioningTransactionAdapter,
    },
    {
      provide: MEMBERSHIP_INVITATION_TOKEN_PORT,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): MembershipInvitationTokenPort =>
        new HmacMembershipInvitationTokenAdapter(environment.identitySecurity.tokenPepper),
    },
    {
      provide: MEMBERSHIP_INVITATION_ENVELOPE_PORT,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): MembershipInvitationEnvelopePort => {
        const security = environment.identitySecurity;
        return new AesMembershipInvitationEnvelopeAdapter(
          security.activeEnvelopeKeyId,
          security.envelopeKeys,
        );
      },
    },
    {
      provide: TENANT_ADMIN_INVITATION_ENVELOPE_PORT,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): TenantAdminInvitationEnvelopePort => {
        const security = environment.identitySecurity;
        return new AesTenantAdminInvitationEnvelopeAdapter(
          security.activeEnvelopeKeyId,
          security.envelopeKeys,
        );
      },
    },
    {
      provide: TENANT_ACTIVATION_TOKEN_PORT,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): TenantActivationTokenPort =>
        new HmacTenantActivationTokenAdapter(environment.identitySecurity.tokenPepper),
    },
    {
      provide: TENANT_ACTIVATION_ENVELOPE_PORT,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService): TenantActivationEnvelopePort => {
        const security = environment.identitySecurity;
        return new AesTenantActivationEnvelopeAdapter(
          security.activeEnvelopeKeyId,
          security.envelopeKeys,
        );
      },
    },
    {
      provide: PlatformTenantProvisioningWorkflow,
      inject: [
        PLATFORM_TENANT_PROVISIONING_TRANSACTION_PORT,
        MEMBERSHIP_INVITATION_TOKEN_PORT,
        MEMBERSHIP_INVITATION_ENVELOPE_PORT,
        TENANT_ACTIVATION_TOKEN_PORT,
        TENANT_ACTIVATION_ENVELOPE_PORT,
      ],
      useFactory: (
        transaction: PlatformTenantProvisioningTransactionPort,
        invitationTokens: MembershipInvitationTokenPort,
        invitationEnvelope: MembershipInvitationEnvelopePort,
        activationTokens: TenantActivationTokenPort,
        activationEnvelope: TenantActivationEnvelopePort,
      ): PlatformTenantProvisioningWorkflow =>
        new PlatformTenantProvisioningWorkflow(transaction, {
          invitationTokens,
          invitationEnvelope,
          activationTokens,
          activationEnvelope,
        }),
    },
    {
      provide: TenantAdminInvitationWorkflow,
      inject: [
        PLATFORM_TENANT_PROVISIONING_TRANSACTION_PORT,
        MEMBERSHIP_INVITATION_TOKEN_PORT,
        TENANT_ADMIN_INVITATION_ENVELOPE_PORT,
        TENANT_ACTIVATION_TOKEN_PORT,
        TENANT_ACTIVATION_ENVELOPE_PORT,
      ],
      useFactory: (
        transaction: PlatformTenantProvisioningTransactionPort,
        invitationTokens: MembershipInvitationTokenPort,
        invitationEnvelope: TenantAdminInvitationEnvelopePort,
        activationTokens: TenantActivationTokenPort,
        activationEnvelope: TenantActivationEnvelopePort,
      ): TenantAdminInvitationWorkflow =>
        new TenantAdminInvitationWorkflow(transaction, {
          invitationTokens,
          invitationEnvelope,
          activationTokens,
          activationEnvelope,
        }),
    },
    PrismaPlatformTenantProvisioningQueryAdapter,
    {
      provide: ProvisionTenantUseCase,
      inject: [PlatformTenantProvisioningWorkflow, EnvironmentService],
      useFactory: (
        workflow: PlatformTenantProvisioningWorkflow,
        environment: EnvironmentService,
      ): ProvisionTenantUseCase =>
        new ProvisionTenantUseCase(workflow, {
          platformHostname: environment.platformHostname,
          tenantBaseDomain: environment.tenantBaseDomain,
          reservedTenantSlugs: ["api", "platform", "www"],
        }),
    },
    {
      provide: BuildPlatformAuthorizationContextUseCase,
      inject: [PLATFORM_AUTHORIZATION_PORT],
      useFactory: (
        authorization: PlatformAuthorizationPort,
      ): BuildPlatformAuthorizationContextUseCase =>
        new BuildPlatformAuthorizationContextUseCase(authorization),
    },
    {
      provide: BuildTenantAuthorizationContextUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): BuildTenantAuthorizationContextUseCase =>
        new BuildTenantAuthorizationContextUseCase(transactions),
    },
    {
      provide: AcceptInvitationUseCase,
      inject: [TENANT_TRANSACTION_PORT, MEMBERSHIP_INVITATION_TOKEN_PORT],
      useFactory: (
        transactions: TenantTransactionPort,
        invitationTokens: InvitationAcceptanceTokenPort,
      ): AcceptInvitationUseCase => new AcceptInvitationUseCase(transactions, invitationTokens),
    },
    {
      provide: ListMembershipsUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): ListMembershipsUseCase =>
        new ListMembershipsUseCase(transactions),
    },
    {
      provide: SuspendMembershipUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): SuspendMembershipUseCase =>
        new SuspendMembershipUseCase(transactions),
    },
    {
      provide: RevokeMembershipUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): RevokeMembershipUseCase =>
        new RevokeMembershipUseCase(transactions),
    },
    {
      provide: PromoteOwnerUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): PromoteOwnerUseCase =>
        new PromoteOwnerUseCase(transactions),
    },
    {
      provide: DemoteOwnerUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): DemoteOwnerUseCase =>
        new DemoteOwnerUseCase(transactions),
    },
    {
      provide: InviteTenantAdminUseCase,
      inject: [TenantAdminInvitationWorkflow],
      useFactory: (workflow: TenantAdminInvitationWorkflow): InviteTenantAdminUseCase =>
        new InviteTenantAdminUseCase(workflow),
    },
    {
      provide: ResendInvitationUseCase,
      inject: [TenantAdminInvitationWorkflow],
      useFactory: (workflow: TenantAdminInvitationWorkflow): ResendInvitationUseCase =>
        new ResendInvitationUseCase(workflow),
    },
    {
      provide: GetCurrentInvitationUseCase,
      inject: [TenantAdminInvitationWorkflow],
      useFactory: (workflow: TenantAdminInvitationWorkflow): GetCurrentInvitationUseCase =>
        new GetCurrentInvitationUseCase(workflow),
    },
    {
      provide: ResolvePendingInvitationLoginUseCase,
      inject: [GetCurrentInvitationUseCase],
      useFactory: (
        currentInvitation: GetCurrentInvitationUseCase,
      ): ResolvePendingInvitationLoginUseCase =>
        new ResolvePendingInvitationLoginUseCase(currentInvitation),
    },
    {
      provide: GetTenantProvisioningUseCase,
      inject: [PrismaPlatformTenantProvisioningQueryAdapter, EnvironmentService],
      useFactory: (
        query: PrismaPlatformTenantProvisioningQueryAdapter,
        environment: EnvironmentService,
      ): GetTenantProvisioningUseCase =>
        new GetTenantProvisioningUseCase(query, {
          platformHostname: environment.platformHostname,
        }),
    },
    {
      provide: ResendOwnerInvitationUseCase,
      inject: [PlatformTenantProvisioningWorkflow, EnvironmentService],
      useFactory: (
        workflow: PlatformTenantProvisioningWorkflow,
        environment: EnvironmentService,
      ): ResendOwnerInvitationUseCase =>
        new ResendOwnerInvitationUseCase(workflow, {
          platformHostname: environment.platformHostname,
        }),
    },
  ],
  exports: [
    ProvisionTenantUseCase,
    GetTenantProvisioningUseCase,
    ResendOwnerInvitationUseCase,
    BuildPlatformAuthorizationContextUseCase,
    BuildTenantAuthorizationContextUseCase,
    InviteTenantAdminUseCase,
    ResendInvitationUseCase,
    GetCurrentInvitationUseCase,
    ResolvePendingInvitationLoginUseCase,
    ListMembershipsUseCase,
    SuspendMembershipUseCase,
    RevokeMembershipUseCase,
    PromoteOwnerUseCase,
    DemoteOwnerUseCase,
  ],
})
export class MembershipsModule {}
