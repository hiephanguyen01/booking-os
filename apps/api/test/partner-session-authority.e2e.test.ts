import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { parseSessionToken } from "@booking-os/auth";
import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service.js";
import { PrismaTenantDataSessionFactory } from "../src/database/prisma-tenant-data-session.factory.js";
import type { AuthorizationRepositoryScope } from "../src/modules/authorization/application/ports/authorization-repository.port.js";
import { PrismaAuthorizationRepositoryAdapter } from "../src/modules/authorization/infrastructure/persistence/prisma/prisma-authorization-repository.adapter.js";
import type {
  SessionScope,
  StoredSession,
} from "../src/modules/sessions/application/ports/session-repository.port.js";
import {
  type CreateSessionInput,
  CreateSessionUseCase,
} from "../src/modules/sessions/application/use-cases/create-session.js";
import { PrismaSessionRepositoryAdapter } from "../src/modules/sessions/infrastructure/persistence/prisma/prisma-session-repository.adapter.js";
import { PrismaTenantTransactionAdapter } from "../src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.js";

const prisma = new PrismaClient();
const USER_ID = randomUUID();
const TENANT_ID = randomUUID();
const TENANT_MEMBERSHIP_ID = randomUUID();
const TENANT_ROLE_ASSIGNMENT_ID = randomUUID();
const PARTNER_ID = randomUUID();
const PARTNER_MEMBERSHIP_ID = randomUUID();
const PARTNER_ROLE_ASSIGNMENT_ID = randomUUID();
const HOSTNAME = "partner-session.example.test";
const REQUEST_ID = `partner-session-red-${randomUUID()}`;
const NOW = new Date("2026-08-24T00:00:00.000Z");

const partnerScope = {
  type: "partner" as const,
  tenantId: TENANT_ID,
  partnerId: PARTNER_ID,
};

const tenantTransactions = new PrismaTenantTransactionAdapter(
  prisma as unknown as PrismaService,
  new PrismaTenantDataSessionFactory(),
);

async function seedAuthorityFixture(): Promise<void> {
  const email = `${USER_ID}@example.test`;
  const slug = `partner-session-${TENANT_ID.slice(0, 8)}`;
  const tenantOwner = await prisma.role.findUnique({
    where: { key: "tenant_owner" },
    select: { id: true },
  });
  const partnerOwner = await prisma.role.findUnique({
    where: { key: "partner_owner" },
    select: { id: true },
  });
  assert.ok(tenantOwner, "tenant_owner role must be seeded by migrations");
  assert.ok(partnerOwner, "partner_owner role must be seeded by migrations");

  await prisma.$executeRaw`
    INSERT INTO "users" (
      "id", "normalized_email", "display_email", "status", "authorization_version",
      "created_at", "updated_at"
    )
    VALUES (
      ${USER_ID}::uuid, ${email}, ${email}, 'active'::user_status, 7,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name")
    VALUES (${TENANT_ID}::uuid, ${slug}, ${slug})
  `;
  await prisma.tenantMembership.create({
    data: {
      id: TENANT_MEMBERSHIP_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      status: "active",
      authorizationVersion: 5,
      acceptedAt: NOW,
    },
  });
  await prisma.roleAssignment.create({
    data: {
      id: TENANT_ROLE_ASSIGNMENT_ID,
      userId: USER_ID,
      roleId: tenantOwner.id,
      scopeLevel: "tenant",
      tenantId: TENANT_ID,
    },
  });
  await prisma.$executeRaw`
    INSERT INTO "partners" (
      "id", "tenant_id", "type", "application_status", "operational_status",
      "authorization_version", "version", "created_at", "updated_at"
    )
    VALUES (
      ${PARTNER_ID}::uuid, ${TENANT_ID}::uuid, 'individual'::partner_type,
      'draft'::partner_application_status, 'inactive'::partner_operational_status,
      3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  await prisma.partnerMembership.create({
    data: {
      id: PARTNER_MEMBERSHIP_ID,
      tenantId: TENANT_ID,
      partnerId: PARTNER_ID,
      tenantMembershipId: TENANT_MEMBERSHIP_ID,
      status: "active",
      authorizationVersion: 2,
    },
  });
  await prisma.partnerSystemRoleAssignment.create({
    data: {
      id: PARTNER_ROLE_ASSIGNMENT_ID,
      tenantId: TENANT_ID,
      partnerId: PARTNER_ID,
      partnerMembershipId: PARTNER_MEMBERSHIP_ID,
      roleId: partnerOwner.id,
    },
  });
}

async function loadPartnerBridge() {
  return tenantTransactions.run(
    {
      requestId: `${REQUEST_ID}-authority`,
      traceId: randomUUID(),
      source: "internal",
      tenantId: TENANT_ID,
    },
    (session) => session.partnerAuthorization.loadForUser(PARTNER_ID, USER_ID),
  );
}

before(seedAuthorityFixture);

after(async () => {
  try {
    await prisma.securityAuditEvent.deleteMany({ where: { requestId: REQUEST_ID } });
    await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
  } finally {
    await prisma.$disconnect();
  }
});

test("partner-scoped opaque sessions round-trip tenant, Partner, and all four authorization snapshots", async () => {
  const repository = new PrismaSessionRepositoryAdapter(prisma as unknown as PrismaService);
  const createSession = new CreateSessionUseCase(repository, {
    digestKey: new Uint8Array(32).fill(17),
    now: () => NOW,
    idFactory: randomUUID,
  });

  const input = {
    userId: USER_ID,
    scope: partnerScope,
    hostname: HOSTNAME,
    state: "active" as const,
    authorizationVersion: 7,
    membershipAuthorizationVersion: 5,
    partnerAuthorizationVersion: 3,
    partnerMembershipAuthorizationVersion: 2,
    requestId: REQUEST_ID,
  } as unknown as CreateSessionInput;

  const created = await createSession.execute(input);
  const parsed = parseSessionToken(created.token);
  assert.ok(parsed);

  const found = await repository.findBySelector({
    selector: parsed.selector,
    hostname: HOSTNAME,
    scope: partnerScope as unknown as SessionScope,
  });
  assert.ok(found, "Partner-scoped session must round-trip through the repository");

  const session = found.session as StoredSession & {
    readonly scope: typeof partnerScope;
    readonly partnerAuthorizationVersion?: number;
    readonly partnerMembershipAuthorizationVersion?: number;
  };
  assert.deepEqual(session.scope, partnerScope);
  assert.equal(session.authorizationVersion, 7);
  assert.equal(session.membershipAuthorizationVersion, 5);
  assert.equal(session.partnerAuthorizationVersion, 3);
  assert.equal(session.partnerMembershipAuthorizationVersion, 2);

  assert.equal(
    await repository.findBySelector({
      selector: parsed.selector,
      hostname: "wrong-host.example.test",
      scope: partnerScope as unknown as SessionScope,
    }),
    null,
    "wrong host must not resolve a Partner session",
  );
  assert.equal(
    await repository.findBySelector({
      selector: parsed.selector,
      hostname: HOSTNAME,
      scope: {
        type: "partner",
        tenantId: TENANT_ID,
        partnerId: randomUUID(),
      } as unknown as SessionScope,
    }),
    null,
    "foreign Partner id must not resolve the stored Partner authority",
  );
});

test("authorization repository reconstructs Partner authority from server state", async () => {
  const repository = new PrismaAuthorizationRepositoryAdapter(
    prisma as unknown as PrismaService,
    tenantTransactions,
  );
  const authority = await repository.loadCurrentScope({
    userId: USER_ID,
    scope: partnerScope as unknown as AuthorizationRepositoryScope,
    execution: {
      requestId: `${REQUEST_ID}-repository`,
      traceId: randomUUID(),
      source: "internal",
      actorId: USER_ID,
    },
  });

  assert.ok(authority, "active Partner authority must be reconstructable");
  const partnerAuthority = authority as unknown as {
    readonly scope: {
      readonly type: string;
      readonly tenantId: string;
      readonly tenantSlug: string;
      readonly partnerId: string;
    };
    readonly userAuthorizationVersion: number;
    readonly membershipId: string;
    readonly membershipStatus: string;
    readonly membershipAuthorizationVersion: number;
    readonly partnerMembershipId: string;
    readonly partnerAuthorizationVersion: number;
    readonly partnerMembershipAuthorizationVersion: number;
    readonly roleKeys: readonly string[];
    readonly permissionKeys: readonly string[];
  };
  assert.equal(partnerAuthority.scope.type, "partner");
  assert.equal(partnerAuthority.scope.tenantId, TENANT_ID);
  assert.equal(partnerAuthority.scope.partnerId, PARTNER_ID);
  assert.equal(partnerAuthority.userAuthorizationVersion, 7);
  assert.equal(partnerAuthority.membershipId, TENANT_MEMBERSHIP_ID);
  assert.equal(partnerAuthority.membershipStatus, "active");
  assert.equal(partnerAuthority.membershipAuthorizationVersion, 5);
  assert.equal(partnerAuthority.partnerMembershipId, PARTNER_MEMBERSHIP_ID);
  assert.equal(partnerAuthority.partnerAuthorizationVersion, 3);
  assert.equal(partnerAuthority.partnerMembershipAuthorizationVersion, 2);
  assert.deepEqual(partnerAuthority.roleKeys, ["partner_owner"]);
  assert.ok(
    partnerAuthority.permissionKeys.length > 0 &&
      partnerAuthority.permissionKeys.every((permission) => permission.startsWith("partner.")),
    "Partner scope must contain only Partner permissions",
  );
});

test("Partner authority bridge fails closed for suspended lifecycle and membership state", async (t) => {
  assert.ok(await loadPartnerBridge(), "baseline active Partner authority must exist");

  await t.test("suspended Partner", async () => {
    await prisma.partner.update({
      where: { id: PARTNER_ID },
      data: { operationalStatus: "suspended", suspendedAt: NOW },
    });
    const authority = await loadPartnerBridge();
    await prisma.partner.update({
      where: { id: PARTNER_ID },
      data: { operationalStatus: "inactive", suspendedAt: null },
    });
    assert.equal(authority, null);
  });

  await t.test("suspended PartnerMembership", async () => {
    await prisma.partnerMembership.update({
      where: { id: PARTNER_MEMBERSHIP_ID },
      data: { status: "suspended", suspendedAt: NOW },
    });
    const authority = await loadPartnerBridge();
    await prisma.partnerMembership.update({
      where: { id: PARTNER_MEMBERSHIP_ID },
      data: { status: "active", suspendedAt: null },
    });
    assert.equal(authority, null);
  });

  await t.test("cancelled Partner", async () => {
    await prisma.partner.update({
      where: { id: PARTNER_ID },
      data: { operationalStatus: "cancelled", cancelledAt: NOW },
    });
    const authority = await loadPartnerBridge();
    assert.equal(authority, null);
  });
});
