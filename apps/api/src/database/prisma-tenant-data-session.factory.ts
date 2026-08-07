import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaInvitationRepositoryAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-invitation-repository.adapter.js";
import { PrismaMembershipRepositoryAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-membership-repository.adapter.js";
import { PrismaTenantProvisioningRepositoryAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-tenant-provisioning-repository.adapter.js";
import { PrismaTenantRoleAssignmentRepositoryAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-tenant-role-assignment-repository.adapter.js";
import { PrismaTenantSecurityAuditAdapter } from "../modules/memberships/infrastructure/persistence/prisma/prisma-tenant-security-audit.adapter.js";
import type { TenantDataSession } from "../modules/tenancy/application/ports/tenant-transaction.port.js";
import { PrismaTenantProbeRepositoryAdapter } from "../modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-probe-repository.adapter.js";

@Injectable()
export class PrismaTenantDataSessionFactory {
  create(transaction: Prisma.TransactionClient, tenantId: string): TenantDataSession {
    return Object.freeze({
      tenantProbes: new PrismaTenantProbeRepositoryAdapter(transaction),
      memberships: new PrismaMembershipRepositoryAdapter(transaction, tenantId),
      invitations: new PrismaInvitationRepositoryAdapter(transaction, tenantId),
      roles: new PrismaTenantRoleAssignmentRepositoryAdapter(transaction, tenantId),
      tenants: new PrismaTenantProvisioningRepositoryAdapter(transaction, tenantId),
      audit: new PrismaTenantSecurityAuditAdapter(transaction, tenantId),
    });
  }
}
