import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const tenants = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "tenant-a",
    name: "Tenant A",
    probeValue: "seed-a",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "tenant-b",
    name: "Tenant B",
    probeValue: "seed-b",
  },
] as const;

async function seedTenantProbe(tenantId: string, value: string): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await transaction.tenantProbe.deleteMany();
    await transaction.tenantProbe.create({ data: { tenantId, value } });
  });
}

async function main(): Promise<void> {
  for (const tenant of tenants) {
    await prisma.tenant.upsert({
      where: { id: tenant.id },
      update: { slug: tenant.slug, name: tenant.name },
      create: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    });
    await seedTenantProbe(tenant.id, tenant.probeValue);
  }
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
