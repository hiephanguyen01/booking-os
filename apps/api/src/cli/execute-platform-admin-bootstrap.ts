import { randomUUID } from "node:crypto";

import { normalizeEmail } from "@booking-os/auth";
import {
  IdentityScopeType,
  type Prisma,
  type PrismaClient,
  RoleScopeLevel,
  UserStatus,
} from "@prisma/client";

import type { IdentitySecurityConfig } from "../config/environment.schema.js";
import {
  identityEmailAssociatedData,
  identityTokenPurpose,
  normalizeHostname,
} from "../modules/identity/application/use-cases/identity-use-case-utils.js";
import { AesSensitiveEnvelopeAdapter } from "../modules/identity/infrastructure/crypto/aes-sensitive-envelope.adapter.js";
import { HmacOneTimeTokenAdapter } from "../modules/identity/infrastructure/crypto/hmac-one-time-token.adapter.js";
import { PlatformAdminAlreadyBootstrappedError } from "./bootstrap-platform-admin.js";

const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVATION_EVENT_TYPE = "identity.activation.requested.v1" as const;
const ACTIVATION_TEMPLATE = "account_activation" as const;
const PLATFORM_ADMIN_ROLE_KEY = "platform_admin";
const BOOTSTRAP_LOCK_NAMESPACE = "booking-os";
const BOOTSTRAP_LOCK_NAME = "platform-admin-bootstrap";

export { PlatformAdminAlreadyBootstrappedError } from "./bootstrap-platform-admin.js";

export interface ExecutePlatformAdminBootstrapInput {
  readonly prisma: PrismaClient;
  readonly email: string;
  readonly hostname: string;
  readonly security: Pick<
    IdentitySecurityConfig,
    "tokenPepper" | "envelopeKeys" | "activeEnvelopeKeyId"
  >;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface ExecutePlatformAdminBootstrapResult {
  readonly userId: string;
  readonly created: boolean;
}

export class PlatformAdminBootstrapRoleMissingError extends Error {
  readonly code = "identity.bootstrap.platform_admin_role_missing" as const;

  constructor() {
    super("The platform administrator role catalog is unavailable.");
    this.name = "PlatformAdminBootstrapRoleMissingError";
  }
}

async function acquireBootstrapLock(transaction: Prisma.TransactionClient): Promise<void> {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${BOOTSTRAP_LOCK_NAMESPACE}),
      hashtext(${BOOTSTRAP_LOCK_NAME})
    )
  `;
}

export async function executePlatformAdminBootstrap(
  input: ExecutePlatformAdminBootstrapInput,
): Promise<ExecutePlatformAdminBootstrapResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const displayEmail = input.email.trim().normalize("NFC");
  const hostname = normalizeHostname(input.hostname);
  const now = (input.now ?? (() => new Date()))();
  const createId = input.createId ?? randomUUID;
  const tokens = new HmacOneTimeTokenAdapter(input.security.tokenPepper);
  const envelope = new AesSensitiveEnvelopeAdapter(
    input.security.activeEnvelopeKeyId,
    input.security.envelopeKeys,
  );

  return input.prisma.$transaction(async (transaction) => {
    await acquireBootstrapLock(transaction);

    const existingAssignment = await transaction.roleAssignment.findFirst({
      where: {
        scopeLevel: RoleScopeLevel.platform,
        tenantId: null,
        revokedAt: null,
        role: { key: PLATFORM_ADMIN_ROLE_KEY },
      },
      include: { user: true },
    });

    if (existingAssignment) {
      if (existingAssignment.user.normalizedEmail !== normalizedEmail) {
        throw new PlatformAdminAlreadyBootstrappedError();
      }

      return Object.freeze({ userId: existingAssignment.userId, created: false });
    }

    const role = await transaction.role.findUnique({
      where: { key: PLATFORM_ADMIN_ROLE_KEY },
      select: { id: true, scopeLevel: true },
    });

    if (!role || role.scopeLevel !== RoleScopeLevel.platform) {
      throw new PlatformAdminBootstrapRoleMissingError();
    }

    const existingUser = await transaction.user.findUnique({
      where: { normalizedEmail },
    });
    const user =
      existingUser ??
      (await transaction.user.create({
        data: {
          normalizedEmail,
          displayEmail,
          status: UserStatus.pendingActivation,
        },
      }));

    await transaction.roleAssignment.create({
      data: {
        userId: user.id,
        roleId: role.id,
        scopeLevel: RoleScopeLevel.platform,
        tenantId: null,
        createdAt: now,
      },
    });

    if (user.status === UserStatus.pendingActivation) {
      const purpose = identityTokenPurpose("activation", "platform", null, hostname);
      const issued = tokens.issue(purpose);
      const tokenId = createId();
      const eventId = createId();
      const expiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS);
      const associatedData = identityEmailAssociatedData({
        eventType: ACTIVATION_EVENT_TYPE,
        eventId,
        userId: user.id,
        hostname,
        recipient: user.displayEmail,
        template: ACTIVATION_TEMPLATE,
      });
      const sealed = envelope.seal(
        new TextEncoder().encode(JSON.stringify({ token: issued.serialized })),
        associatedData,
      );

      await transaction.accountActivationToken.updateMany({
        where: {
          userId: user.id,
          scopeType: IdentityScopeType.platform,
          tenantId: null,
          hostname,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await transaction.accountActivationToken.create({
        data: {
          id: tokenId,
          userId: user.id,
          scopeType: IdentityScopeType.platform,
          tenantId: null,
          invitationId: null,
          hostname,
          selector: issued.selector,
          tokenHash: issued.tokenHash,
          expiresAt,
          createdAt: now,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          id: eventId,
          tenantId: null,
          type: ACTIVATION_EVENT_TYPE,
          aggregateType: "user",
          aggregateId: user.id,
          payload: {
            version: 1,
            recipient: user.displayEmail,
            template: ACTIVATION_TEMPLATE,
            hostname,
            envelope: sealed,
          } as unknown as Prisma.InputJsonValue,
          occurredAt: now,
          availableAt: now,
        },
      });
    }

    await transaction.securityAuditEvent.create({
      data: {
        eventType: "identity.platform_admin.bootstrapped",
        actorUserId: user.id,
        subjectUserId: user.id,
        requestId: null,
        metadata: { hostname, scopeType: "platform" },
        occurredAt: now,
      },
    });

    return Object.freeze({ userId: user.id, created: true });
  });
}
