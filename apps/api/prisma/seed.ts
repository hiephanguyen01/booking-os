import { PrismaClient, RoleScopeLevel } from "@prisma/client";

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

const platformAdminRole = {
  id: "00000000-0000-4000-8000-000000000101",
  key: "platform_admin",
  scopeLevel: RoleScopeLevel.platform,
  isSystem: true,
} as const;

const platformPermissions = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    key: "platform.security.audit.read",
    description: "Read platform security audit events.",
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    key: "platform.tenants.provision",
    description: "Provision a tenant and its initial owner invitation.",
  },
  {
    id: "00000000-0000-4000-8000-000000000203",
    key: "platform.users.provision",
    description: "Provision global user accounts.",
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

async function seedAuthorizationCatalog(): Promise<void> {
  const role = await prisma.role.upsert({
    where: { key: platformAdminRole.key },
    update: {
      scopeLevel: platformAdminRole.scopeLevel,
      isSystem: platformAdminRole.isSystem,
    },
    create: platformAdminRole,
  });

  for (const permissionDefinition of platformPermissions) {
    const permission = await prisma.permission.upsert({
      where: { key: permissionDefinition.key },
      update: {
        scopeLevel: RoleScopeLevel.platform,
        description: permissionDefinition.description,
      },
      create: {
        ...permissionDefinition,
        scopeLevel: RoleScopeLevel.platform,
      },
    });

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: role.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: role.id,
        permissionId: permission.id,
      },
    });
  }
}

async function main(): Promise<void> {
  await seedAuthorizationCatalog();

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
