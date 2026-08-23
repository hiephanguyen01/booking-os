import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { parseSessionToken } from "@booking-os/auth";
import { PrismaClient } from "@prisma/client";

import type { PrismaService } from "../src/database/prisma.service.js";
import type {
  SessionScope,
  StoredSession,
} from "../src/modules/sessions/application/ports/session-repository.port.js";
import {
  type CreateSessionInput,
  CreateSessionUseCase,
} from "../src/modules/sessions/application/use-cases/create-session.js";
import { PrismaSessionRepositoryAdapter } from "../src/modules/sessions/infrastructure/persistence/prisma/prisma-session-repository.adapter.js";

const prisma = new PrismaClient();
const USER_ID = randomUUID();
const TENANT_ID = randomUUID();
const PARTNER_ID = randomUUID();
const HOSTNAME = "partner-session.example.test";
const REQUEST_ID = `partner-session-red-${randomUUID()}`;
const NOW = new Date("2026-08-24T00:00:00.000Z");

const partnerScope = {
  type: "partner" as const,
  tenantId: TENANT_ID,
  partnerId: PARTNER_ID,
};

async function seedAuthorityFixture(): Promise<void> {
  const email = `${USER_ID}@example.test`;
  const slug = `partner-session-${TENANT_ID.slice(0, 8)}`;

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
}

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
  await seedAuthorityFixture();

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
});
