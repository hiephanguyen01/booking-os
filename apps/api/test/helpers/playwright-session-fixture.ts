import { createHash, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAYWRIGHT_SESSION_SECRET = "e2e-only-session-secret-at-least-32-characters";
const PLAYWRIGHT_DATABASE_URL =
  process.env.PLAYWRIGHT_DATABASE_URL ??
  "postgresql://booking:booking@127.0.0.1:5432/booking_os_test";
const FIXTURE_OWNER_USER_ID = "99999999-9999-4999-8999-999999999999";
const TENANT_ROLE_IDS = {
  tenant_owner: "00000000-0000-4000-8000-000000000102",
  tenant_admin: "00000000-0000-4000-8000-000000000103",
} as const;

type TenantRoleKey = keyof typeof TENANT_ROLE_IDS;

interface PlatformPlaywrightSessionInput {
  readonly userId: string;
  readonly hostname: string;
  readonly scope: { readonly type: "platform" };
}

interface TenantPlaywrightSessionInput {
  readonly userId: string;
  readonly hostname: string;
  readonly tenantRoleKey: TenantRoleKey;
  readonly scope: { readonly type: "tenant"; readonly tenantId: string };
}

export type PlaywrightSessionInput = PlatformPlaywrightSessionInput | TenantPlaywrightSessionInput;

function isTenantSessionInput(
  input: PlaywrightSessionInput,
): input is TenantPlaywrightSessionInput {
  return "tenantRoleKey" in input && input.scope.type === "tenant";
}

function deriveSessionDigestKey(): Uint8Array {
  return createHash("sha256")
    .update("booking-os/session-token-digest/v1\0", "utf8")
    .update(PLAYWRIGHT_SESSION_SECRET, "utf8")
    .digest();
}

export async function createPlaywrightSession(input: PlaywrightSessionInput): Promise<string> {
  const { createSessionToken, deriveSessionSecretDigest, parseSessionToken } = await import(
    "@booking-os/auth"
  );
  const prisma = new PrismaClient({
    datasources: {
      db: { url: PLAYWRIGHT_DATABASE_URL },
    },
  });
  const now = new Date();
  const authorizationVersion = 1;
  const fixtureEmail = `playwright-${input.userId}@example.test`;
  const binding =
    input.scope.type === "platform"
      ? { scopeType: "platform" as const, tenantId: null }
      : { scopeType: "tenant" as const, tenantId: input.scope.tenantId };

  try {
    await prisma.user.upsert({
      where: { id: input.userId },
      update: {
        normalizedEmail: fixtureEmail,
        displayEmail: fixtureEmail,
        status: "active",
        authorizationVersion,
        activatedAt: now,
        suspendedAt: null,
        disabledAt: null,
      },
      create: {
        id: input.userId,
        normalizedEmail: fixtureEmail,
        displayEmail: fixtureEmail,
        status: "active",
        authorizationVersion,
        activatedAt: now,
      },
    });

    if (isTenantSessionInput(input)) {
      const tenantId = input.scope.tenantId;
      const tenantRoleKey = input.tenantRoleKey;
      const fixtureOwnerEmail = `playwright-${FIXTURE_OWNER_USER_ID}@example.test`;
      await prisma.user.upsert({
        where: { id: FIXTURE_OWNER_USER_ID },
        update: {
          normalizedEmail: fixtureOwnerEmail,
          displayEmail: fixtureOwnerEmail,
          status: "active",
          authorizationVersion,
          activatedAt: now,
          suspendedAt: null,
          disabledAt: null,
        },
        create: {
          id: FIXTURE_OWNER_USER_ID,
          normalizedEmail: fixtureOwnerEmail,
          displayEmail: fixtureOwnerEmail,
          status: "active",
          authorizationVersion,
          activatedAt: now,
        },
      });

      await prisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
        await transaction.$executeRawUnsafe(
          "SELECT set_config('app.tenant_id', $1, true)",
          tenantId,
        );

        await transaction.tenantMembership.upsert({
          where: { tenantId_userId: { tenantId, userId: FIXTURE_OWNER_USER_ID } },
          update: {
            status: "active",
            authorizationVersion,
            acceptedAt: now,
            suspendedAt: null,
            revokedAt: null,
          },
          create: {
            tenantId,
            userId: FIXTURE_OWNER_USER_ID,
            status: "active",
            authorizationVersion,
            acceptedAt: now,
          },
        });

        const fixtureOwnerAssignment = await transaction.roleAssignment.findFirst({
          where: {
            tenantId,
            userId: FIXTURE_OWNER_USER_ID,
            scopeLevel: "tenant",
            revokedAt: null,
          },
          select: { id: true, roleId: true },
        });
        if (!fixtureOwnerAssignment) {
          await transaction.roleAssignment.create({
            data: {
              tenantId,
              userId: FIXTURE_OWNER_USER_ID,
              scopeLevel: "tenant",
              roleId: TENANT_ROLE_IDS.tenant_owner,
            },
          });
        } else if (fixtureOwnerAssignment.roleId !== TENANT_ROLE_IDS.tenant_owner) {
          await transaction.roleAssignment.update({
            where: { id: fixtureOwnerAssignment.id },
            data: { roleId: TENANT_ROLE_IDS.tenant_owner },
          });
        }

        await transaction.tenantMembership.upsert({
          where: { tenantId_userId: { tenantId, userId: input.userId } },
          update: {
            status: "active",
            authorizationVersion,
            acceptedAt: now,
            suspendedAt: null,
            revokedAt: null,
          },
          create: {
            tenantId,
            userId: input.userId,
            status: "active",
            authorizationVersion,
            acceptedAt: now,
          },
        });

        const actorAssignment = await transaction.roleAssignment.findFirst({
          where: {
            tenantId,
            userId: input.userId,
            scopeLevel: "tenant",
            revokedAt: null,
          },
          select: { id: true, roleId: true },
        });
        const actorRoleId = TENANT_ROLE_IDS[tenantRoleKey];
        if (!actorAssignment) {
          await transaction.roleAssignment.create({
            data: {
              tenantId,
              userId: input.userId,
              scopeLevel: "tenant",
              roleId: actorRoleId,
            },
          });
        } else if (actorAssignment.roleId !== actorRoleId) {
          await transaction.roleAssignment.update({
            where: { id: actorAssignment.id },
            data: { roleId: actorRoleId },
          });
        }
      });

      await prisma.tenant.update({
        where: { id: tenantId },
        data: { status: "active" },
      });
    }

    await prisma.authSession.deleteMany({ where: { userId: input.userId } });

    const token = createSessionToken();
    const parsed = parseSessionToken(token);
    if (!parsed) {
      throw new TypeError("Playwright session token generation returned an invalid token.");
    }

    const absoluteExpiresAt = new Date(now.getTime() + 30 * DAY_MS);
    await prisma.authSession.create({
      data: {
        id: randomUUID(),
        userId: input.userId,
        scopeType: binding.scopeType,
        tenantId: binding.tenantId,
        hostname: input.hostname,
        state: "active",
        authorizationVersion,
        version: 1,
        idleExpiresAt: new Date(now.getTime() + 7 * DAY_MS),
        absoluteExpiresAt,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
        tokens: {
          create: {
            id: randomUUID(),
            scopeType: binding.scopeType,
            tenantId: binding.tenantId,
            selector: parsed.selector,
            tokenHash: deriveSessionSecretDigest({
              digestKey: deriveSessionDigestKey(),
              secret: parsed.secret,
            }),
            issuedAt: now,
            expiresAt: absoluteExpiresAt,
          },
        },
      },
    });

    return token;
  } finally {
    await prisma.$disconnect();
  }
}
