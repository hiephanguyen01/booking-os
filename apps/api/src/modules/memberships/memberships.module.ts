import { Module } from "@nestjs/common";

import { EnvironmentService } from "../../config/environment.service.js";
import { DatabaseModule } from "../../database/database.module.js";
import type { MembershipInvitationEnvelopePort } from "./application/ports/membership-invitation-envelope.port.js";
import type { MembershipInvitationTokenPort } from "./application/ports/membership-invitation-token.port.js";
import type { PlatformTenantProvisioningTransactionPort } from "./application/ports/platform-tenant-provisioning-transaction.port.js";
import type { TenantActivationEnvelopePort } from "./application/ports/tenant-activation-envelope.port.js";
import type { TenantActivationTokenPort } from "./application/ports/tenant-activation-token.port.js";
import { PlatformTenantProvisioningWorkflow } from "./application/use-cases/platform-tenant-provisioning.workflow.js";
import { ProvisionTenantUseCase } from "./application/use-cases/provision-tenant.use-case.js";
import {
  MEMBERSHIP_INVITATION_ENVELOPE_PORT,
  MEMBERSHIP_INVITATION_TOKEN_PORT,
  PLATFORM_TENANT_PROVISIONING_TRANSACTION_PORT,
  TENANT_ACTIVATION_ENVELOPE_PORT,
  TENANT_ACTIVATION_TOKEN_PORT,
} from "./memberships.tokens.js";
import {
  AesMembershipInvitationEnvelopeAdapter,
  AesTenantActivationEnvelopeAdapter,
} from "./infrastructure/crypto/aes-membership-provisioning-envelope.adapter.js";
import {
  HmacMembershipInvitationTokenAdapter,
  HmacTenantActivationTokenAdapter,
} from "./infrastructure/crypto/hmac-membership-provisioning-token.adapter.js";
import { PrismaPlatformTenantProvisioningTransactionAdapter } from "./infrastructure/persistence/prisma/prisma-platform-tenant-provisioning-transaction.adapter.js";

@Module({
  imports: [DatabaseModule],
  providers: [
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
  ],
  exports: [ProvisionTenantUseCase],
})
export class MembershipsModule {}
