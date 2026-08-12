import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { PrismaClient, RoleScopeLevel, UserStatus } from "@prisma/client";

import {
  executePlatformAdminBootstrap,
  PlatformAdminAlreadyBootstrappedError,
} from "../src/cli/execute-platform-admin-bootstrap.js";

const prisma = new PrismaClient();
const NOW = new Date("2026-08-05T13:30:00.000Z");
const EMAIL = "bootstrap+pilot@example.com";
const OTHER_EMAIL = "other-admin@example.com";
const HOSTNAME = "console.example.test";
const PLATFORM_ADMIN_ROLE_ID = "00000000-0000-4000-8000-000000000101";

const security = Object.freeze({
  tokenPepper: Buffer.alloc(32, 1),
  envelopeKeys: Object.freeze({ "identity-v1": Buffer.alloc(32, 2) }),
  activeEnvelopeKeyId: "identity-v1",
});

async function cleanBootstrapRows(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { normalizedEmail: { in: [EMAIL, OTHER_EMAIL] } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  if (userIds.length > 0) {
    await prisma.$transaction([
      prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: userIds } } }),
      prisma.accountActivationToken.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.roleAssignment.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.securityAuditEvent.deleteMany({
        where: {
          OR: [{ actorUserId: { in: userIds } }, { subjectUserId: { in: userIds } }],
        },
      }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ]);
  }
}

async function ensurePlatformAdminRole(): Promise<void> {
  await prisma.role.upsert({
    where: { key: "platform_admin" },
    update: { scopeLevel: RoleScopeLevel.platform, isSystem: true },
    create: {
      id: PLATFORM_ADMIN_ROLE_ID,
      key: "platform_admin",
      scopeLevel: RoleScopeLevel.platform,
      isSystem: true,
    },
  });
}

before(async () => {
  await cleanBootstrapRows();
  await ensurePlatformAdminRole();
});

after(async () => {
  await cleanBootstrapRows();
  await prisma.$disconnect();
});

test("concurrent bootstrap creates one pending platform admin, one encrypted activation delivery, and one canonical audit", async () => {
  const results = await Promise.all([
    executePlatformAdminBootstrap({
      prisma,
      email: EMAIL,
      hostname: HOSTNAME,
      security,
      now: () => NOW,
    }),
    executePlatformAdminBootstrap({
      prisma,
      email: EMAIL,
      hostname: HOSTNAME,
      security,
      now: () => NOW,
    }),
  ]);

  assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
  assert.equal(new Set(results.map((result) => result.userId)).size, 1);

  const user = await prisma.user.findUniqueOrThrow({
    where: { normalizedEmail: EMAIL },
  });
  assert.equal(user.status, UserStatus.pendingActivation);
  assert.equal(await prisma.passwordCredential.count({ where: { userId: user.id } }), 0);

  const assignments = await prisma.roleAssignment.findMany({
    where: { userId: user.id, revokedAt: null },
    include: { role: true },
  });
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0]?.role.key, "platform_admin");
  assert.equal(assignments[0]?.scopeLevel, RoleScopeLevel.platform);
  assert.equal(assignments[0]?.tenantId, null);

  const tokens = await prisma.accountActivationToken.findMany({
    where: { userId: user.id, consumedAt: null, revokedAt: null },
  });
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]?.scopeType, "platform");
  assert.equal(tokens[0]?.tenantId, null);
  assert.equal(tokens[0]?.invitationId, null);
  assert.equal(tokens[0]?.hostname, HOSTNAME);
  assert.equal(tokens[0]?.expiresAt.toISOString(), "2026-08-06T13:30:00.000Z");

  const events = await prisma.outboxEvent.findMany({
    where: { aggregateId: user.id, type: "identity.activation.requested.v1" },
  });
  assert.equal(events.length, 1);
  const serializedPayload = JSON.stringify(events[0]?.payload);
  assert.match(serializedPayload, /"envelope"/u);
  assert.doesNotMatch(serializedPayload, /selector|secret|serialized|tokenHash|rawToken/iu);

  const audits = await prisma.securityAuditEvent.findMany({
    where: { actorUserId: user.id, subjectUserId: user.id },
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.eventType, "platform.bootstrap_admin_created");
  assert.equal(audits[0]?.requestId, null);
  assert.deepEqual(audits[0]?.metadata, {
    action: "bootstrap_platform_admin",
    result: "success",
    reason: "initial_platform_admin_created",
    hostname: HOSTNAME,
    scopeType: "platform",
  });
  assert.doesNotMatch(
    JSON.stringify(audits[0]),
    /bootstrap\+pilot|selector|secret|serialized|tokenHash|rawToken|cookie|authorization/iu,
  );
});

test("same configured email is idempotent and a different email is refused", async () => {
  const first = await executePlatformAdminBootstrap({
    prisma,
    email: EMAIL,
    hostname: HOSTNAME,
    security,
    now: () => NOW,
  });
  const second = await executePlatformAdminBootstrap({
    prisma,
    email: EMAIL.toUpperCase(),
    hostname: HOSTNAME.toUpperCase(),
    security,
    now: () => new Date("2026-08-05T13:31:00.000Z"),
  });

  assert.equal(first.userId, second.userId);
  assert.equal(second.created, false);
  assert.equal(await prisma.accountActivationToken.count({ where: { userId: first.userId } }), 1);
  assert.equal(await prisma.outboxEvent.count({ where: { aggregateId: first.userId } }), 1);
  assert.equal(
    await prisma.securityAuditEvent.count({
      where: {
        actorUserId: first.userId,
        subjectUserId: first.userId,
        eventType: "platform.bootstrap_admin_created",
      },
    }),
    1,
  );

  await assert.rejects(
    executePlatformAdminBootstrap({
      prisma,
      email: OTHER_EMAIL,
      hostname: HOSTNAME,
      security,
      now: () => NOW,
    }),
    (error: unknown) => {
      assert.ok(error instanceof PlatformAdminAlreadyBootstrappedError);
      assert.equal(error.code, "identity.bootstrap.platform_admin_exists");
      assert.doesNotMatch(error.message, /bootstrap\+pilot|other-admin/iu);
      return true;
    },
  );
});

test("API package exposes an executable bootstrap command", async () => {
  const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const packageJson = JSON.parse(await readFile(join(apiRoot, "package.json"), "utf8")) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };

  assert.equal(
    packageJson.scripts?.["identity:bootstrap-platform-admin"],
    "tsx src/cli/run-platform-admin-bootstrap.ts",
  );
});
