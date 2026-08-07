import { PrismaClient, RoleScopeLevel, TenantStatus } from "@prisma/client";

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

const systemRoles = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    key: "platform_admin",
    scopeLevel: RoleScopeLevel.platform,
    isSystem: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    key: "tenant_owner",
    scopeLevel: RoleScopeLevel.tenant,
    isSystem: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    key: "tenant_admin",
    scopeLevel: RoleScopeLevel.tenant,
    isSystem: true,
  },
] as const;

const permissionDefinitions = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    key: "platform.security.audit.read",
    scopeLevel: RoleScopeLevel.platform,
    description: "Read platform security audit events.",
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    key: "platform.tenants.provision",
    scopeLevel: RoleScopeLevel.platform,
    description: "Provision a tenant and its initial owner invitation.",
  },
  {
    id: "00000000-0000-4000-8000-000000000203",
    key: "platform.users.provision",
    scopeLevel: RoleScopeLevel.platform,
    description: "Provision global user accounts.",
  },
  {
    id: "00000000-0000-4000-8000-000000000211",
    key: "tenant.membership.read",
    scopeLevel: RoleScopeLevel.tenant,
    description: "Read tenant memberships.",
  },
  {
    id: "00000000-0000-4000-8000-000000000212",
    key: "tenant.membership.admin.invite",
    scopeLevel: RoleScopeLevel.tenant,
    description: "Invite tenant administrators.",
  },
  {
    id: "00000000-0000-4000-8000-000000000213",
    key: "tenant.membership.admin.suspend",
    scopeLevel: RoleScopeLevel.tenant,
    description: "Suspend tenant administrators.",
  },
  {
    id: "00000000-0000-4000-8000-000000000214",
    key: "tenant.membership.admin.revoke",
    scopeLevel: RoleScopeLevel.tenant,
    description: "Revoke tenant administrators.",
  },
  {
    id: "00000000-0000-4000-8000-000000000215",
    key: "tenant.membership.owner.promote",
    scopeLevel: RoleScopeLevel.tenant,
    description: "Promote an active tenant administrator to owner.",
  },
  {
    id: "00000000-0000-4000-8000-000000000216",
    key: "tenant.membership.owner.demote",
    scopeLevel: RoleScopeLevel.tenant,
    description: "Demote a tenant owner while preserving the final-owner invariant.",
  },
  {
    id: "00000000-0000-4000-8000-000000000217",
    key: "tenant.security.session.read",
    scopeLevel: RoleScopeLevel.tenant,
    description: "Read tenant security sessions.",
  },
  {
    id: "00000000-0000-4000-8000-000000000218",
    key: "tenant.security.session.revoke",
    scopeLevel: RoleScopeLevel.tenant,
    description: "Revoke tenant security sessions.",
  },
] as const;

const permissionKeysByRole = {
  platform_admin: [
    "platform.security.audit.read",
    "platform.tenants.provision",
    "platform.users.provision",
  ],
  tenant_owner: [
    "tenant.membership.read",
    "tenant.membership.admin.invite",
    "tenant.membership.admin.suspend",
    "tenant.membership.admin.revoke",
    "tenant.membership.owner.promote",
    "tenant.membership.owner.demote",
    "tenant.security.session.read",
    "tenant.security.session.revoke",
  ],
  tenant_admin: [
    "tenant.membership.read",
    "tenant.membership.admin.invite",
    "tenant.membership.admin.suspend",
    "tenant.membership.admin.revoke",
    "tenant.security.session.read",
    "tenant.security.session.revoke",
  ],
} as const;

async function seedTenantProbe(tenantId: string, value: string): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await transaction.tenantProbe.deleteMany();
    await transaction.tenantProbe.create({ data: { tenantId, value } });
  });
}

async function seedAuthorizationCatalog(): Promise<void> {
  const permissionsByKey = new Map<string, { id: string }>();

  for (const definition of permissionDefinitions) {
    const permission = await prisma.permission.upsert({
      where: { key: definition.key },
      update: {
        scopeLevel: definition.scopeLevel,
        description: definition.description,
      },
      create: definition,
    });
    permissionsByKey.set(definition.key, permission);
  }

  for (const definition of systemRoles) {
    const role = await prisma.role.upsert({
      where: { key: definition.key },
      update: {
        scopeLevel: definition.scopeLevel,
        isSystem: definition.isSystem,
      },
      create: definition,
    });
    const permissionKeys = permissionKeysByRole[definition.key];
    const permissionIds = permissionKeys.map((key) => {
      const permission = permissionsByKey.get(key);
      if (!permission) {
        throw new Error(`Missing seeded permission: ${key}`);
      }
      return permission.id;
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
    });
  }
}

async function main(): Promise<void> {
  await seedAuthorizationCatalog();

  for (const tenant of tenants) {
    await prisma.tenant.upsert({
      where: { id: tenant.id },
      update: {
        slug: tenant.slug,
        name: tenant.name,
        status: TenantStatus.provisioning,
      },
      create: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: TenantStatus.provisioning,
      },
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
