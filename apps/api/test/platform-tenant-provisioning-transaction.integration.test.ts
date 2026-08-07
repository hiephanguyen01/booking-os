import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { PrismaService } from "../src/database/prisma.service.js";
import { PrismaTenantDataSessionFactory } from "../src/database/prisma-tenant-data-session.factory.js";
import { PrismaTenantTransactionAdapter } from "../src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.js";

const prisma = new PrismaService();

after(async () => {
  await prisma.$disconnect();
});

test("target tenant transaction can create provisioning tenant control rows", async () => {
  const tenantId = randomUUID();
  const slug = `provision-${tenantId.slice(0, 8)}`;
  const hostname = `${slug}.booking.test`;
  const now = new Date("2026-08-07T10:00:00.000Z");
  const transaction = new PrismaTenantTransactionAdapter(
    prisma,
    new PrismaTenantDataSessionFactory(),
  );

  try {
    await transaction.run(
      {
        tenantId,
        requestId: `request-${tenantId}`,
        traceId: `trace-${tenantId}`,
        source: "internal",
      },
      async (session) => {
        const tenant = await session.tenants.createProvisioning({
          slug,
          name: "Provisioning Transaction Test",
          now,
        });
        await session.tenants.addPrimaryDomain(hostname, now);

        assert.deepEqual(tenant, {
          id: tenantId,
          slug,
          name: "Provisioning Transaction Test",
          status: "provisioning",
        });
      },
    );

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { domains: true },
    });
    assert.equal(tenant?.status, "provisioning");
    assert.deepEqual(
      tenant?.domains.map((domain) => ({
        hostname: domain.hostname,
        isPrimary: domain.isPrimary,
      })),
      [{ hostname, isPrimary: true }],
    );
  } finally {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  }
});
