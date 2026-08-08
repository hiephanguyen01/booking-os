import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { EnvironmentService } from "../config/environment.service.js";
import { PrismaInvitationRepositoryAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-invitation-repository.adapter.js";
import {
  PrismaInvitationSessionElevationAdapter,
  type PrismaInvitationSessionElevationOptions,
} from "../modules/memberships/infrastructure/persistence/prisma/prisma-invitation-session-elevation.adapter.js";
import { PrismaMembershipRepositoryAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-membership-repository.adapter.js";
import { PrismaTenantAuthorizationQueryAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-tenant-authorization-query.adapter.js";
import { PrismaTenantProvisioningRepositoryAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-tenant-provisioning-repository.adapter.js";
import { PrismaTenantRoleAssignmentRepositoryAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-tenant-role-assignment-repository.adapter.js";
import { PrismaTenantSecurityAuditAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-tenant-security-audit.adapter.js";
import type { TenantDataSession } from "../modules/tenancy/application/ports/tenant-transaction.port.js";
import { PrismaTenantProbeRepositoryAdapter } from "../modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-probe-repository.adapter.js";

function deriveSessionDigestKey(secret: string): Uint8Array {
  return createHash("sha256")
    .update("booking-os/session-token-digest/v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

function isFactoryOptions(
  source: EnvironmentService | PrismaInvitationSessionElevationOptions,
): source is PrismaInvitationSessionElevationOptions {
  return "digestKey" in source;
}

@Injectable()
export class PrismaTenantDataSessionFactory {
  private readonly sessionElevationOptions: PrismaInvitationSessionElevationOptions | undefined;

  constructor(
    @Inject(EnvironmentService)
    source?: EnvironmentService | PrismaInvitationSessionElevationOptions,
  ) {
    this.sessionElevationOptions = source
      ? isFactoryOptions(source)
        ? source
        : { digestKey: deriveSessionDigestKey(source.sessionSecret) }
      : undefined;
  }

  create(transaction: Prisma.TransactionClient, tenantId: string): TenantDataSession {
    return Object.freeze({
      tenantProbes: new PrismaTenantProbeRepositoryAdapter(transaction),
      authorization: new PrismaTenantAuthorizationQueryAdapter(transaction, tenantId),
      memberships: new PrismaMembershipRepositoryAdapter(transaction, tenantId),
      invitations: new PrismaInvitationRepositoryAdapter(transaction, tenantId),
      roles: new PrismaTenantRoleAssignmentRepositoryAdapter(transaction, tenantId),
      tenants: new PrismaTenantProvisioningRepositoryAdapter(transaction, tenantId),
      sessions: new PrismaInvitationSessionElevationAdapter(
        transaction,
        tenantId,
        this.sessionElevationOptions,
      ),
      audit: new PrismaTenantSecurityAuditAdapter(transaction, tenantId),
    });
  }
}
