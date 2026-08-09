import assert from "node:assert/strict";
import test from "node:test";

import type {
  PlatformTenantProvisioningDataSession,
  PlatformTenantProvisioningTransactionContext,
  PlatformTenantProvisioningTransactionPort,
} from "../../../application/ports/platform-tenant-provisioning-transaction.port.js";
import { PrismaPlatformTenantProvisioningQueryAdapter } from "./prisma-platform-tenant-provisioning-query.adapter.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";

test("maps the persisted tenant name into public provisioning status", async () => {
  const session = {
    tenants: {
      async findCurrent() {
        return {
          id: TENANT_ID,
          name: "Acme Studio",
          slug: "acme-studio",
          status: "provisioning" as const,
        };
      },
    },
    invitations: {
      async findPendingOwnerInvitation() {
        return {
          id: "50000000-0000-4000-8000-000000000001",
          invitedUserId: "60000000-0000-4000-8000-000000000001",
        };
      },
    },
    memberships: {
      async findByUserId() {
        return { id: "40000000-0000-4000-8000-000000000001" };
      },
    },
  } as unknown as PlatformTenantProvisioningDataSession;
  const context = {
    async runTenant<T>(tenantId: string, work: (value: PlatformTenantProvisioningDataSession) => Promise<T>) {
      assert.equal(tenantId, TENANT_ID);
      return work(session);
    },
  } as unknown as PlatformTenantProvisioningTransactionContext;
  const transaction: PlatformTenantProvisioningTransactionPort = {
    async run<T>(work: (value: PlatformTenantProvisioningTransactionContext) => Promise<T>) {
      return work(context);
    },
  };
  const adapter = new PrismaPlatformTenantProvisioningQueryAdapter(transaction);

  const result = await adapter.getProvisioning({
    actorUserId: "10000000-0000-4000-8000-000000000001",
    tenantId: TENANT_ID,
  });

  assert.deepEqual(result, {
    tenantId: TENANT_ID,
    tenantName: "Acme Studio",
    slug: "acme-studio",
    status: "provisioning",
    ownerMembershipId: "40000000-0000-4000-8000-000000000001",
    ownerInvitationId: "50000000-0000-4000-8000-000000000001",
  });
});
