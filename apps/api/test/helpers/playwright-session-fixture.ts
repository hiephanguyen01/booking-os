import { createHash, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import {
  createSessionToken,
  deriveSessionSecretDigest,
  parseSessionToken,
} from "../../../../packages/auth/src/opaque-session.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAYWRIGHT_SESSION_SECRET = "e2e-only-session-secret-at-least-32-characters";

interface PlatformPlaywrightSessionInput {
  readonly userId: string;
  readonly hostname: string;
  readonly scope: { readonly type: "platform" };
}

interface TenantPlaywrightSessionInput {
  readonly userId: string;
  readonly hostname: string;
  readonly scope: { readonly type: "tenant"; readonly tenantId: string };
}

export type PlaywrightSessionInput = PlatformPlaywrightSessionInput | TenantPlaywrightSessionInput;

function deriveSessionDigestKey(): Uint8Array {
  return createHash("sha256")
    .update("booking-os/session-token-digest/v1\0", "utf8")
    .update(PLAYWRIGHT_SESSION_SECRET, "utf8")
    .digest();
}

export async function createPlaywrightSession(input: PlaywrightSessionInput): Promise<string> {
  const prisma = new PrismaClient();
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

    if (input.scope.type === "tenant") {
      await prisma.tenant.update({
        where: { id: input.scope.tenantId },
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
