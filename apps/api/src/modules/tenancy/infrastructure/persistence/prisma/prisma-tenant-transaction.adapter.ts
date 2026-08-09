import { AsyncLocalStorage } from "node:async_hooks";

import type {
  AuthorizedTenantExecutionContext,
  TenantExecutionContext,
} from "@booking-os/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaTenantDataSessionFactory } from "../../../../../database/prisma-tenant-data-session.factory.js";
import type {
  TenantDataSession,
  TenantTransactionPort,
} from "../../../application/ports/tenant-transaction.port.js";
import {
  InvalidTenantContextError,
  TenantAuthorizationStaleError,
  TenantContextConflictError,
  TenantExecutionIdentityConflictError,
} from "../../../application/tenant-context.errors.js";
import { requireAuthorizedTenantExecutionContext } from "../../../application/tenant-execution-context.js";
import { isTenantId } from "../../../domain/tenant-id.js";

const APPLICATION_DATABASE_ROLE = "booking_app";

interface ActiveTenantSession {
  readonly context: TenantExecutionContext | AuthorizedTenantExecutionContext;
  readonly session: TenantDataSession;
}

interface LockedUserAuthorityRow {
  readonly status: string;
  readonly authorizationVersion: number;
}

interface LockedMembershipAuthorityRow {
  readonly id: string;
  readonly authorizationVersion: number;
}

function isAuthorized(
  context: TenantExecutionContext,
): context is AuthorizedTenantExecutionContext {
  return "authorization" in context;
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function sameExecutionIdentity(
  active: TenantExecutionContext,
  requested: TenantExecutionContext,
): boolean {
  if (!isAuthorized(active) && !isAuthorized(requested)) return true;
  if (!isAuthorized(active) || !isAuthorized(requested)) return false;
  return (
    active.actorId === requested.actorId &&
    active.sessionId === requested.sessionId &&
    active.authorization.membershipId === requested.authorization.membershipId &&
    active.authorization.userAuthorizationVersion ===
      requested.authorization.userAuthorizationVersion &&
    active.authorization.membershipAuthorizationVersion ===
      requested.authorization.membershipAuthorizationVersion
  );
}

@Injectable()
export class PrismaTenantTransactionAdapter implements TenantTransactionPort {
  private readonly activeSessions = new AsyncLocalStorage<ActiveTenantSession>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrismaTenantDataSessionFactory)
    private readonly sessionFactory: PrismaTenantDataSessionFactory,
  ) {}

  async run<T>(
    context: TenantExecutionContext | AuthorizedTenantExecutionContext,
    work: (session: TenantDataSession) => Promise<T>,
  ): Promise<T> {
    if (!isTenantId(context.tenantId)) {
      throw new InvalidTenantContextError();
    }

    const active = this.activeSessions.getStore();
    if (active) {
      if (active.context.tenantId !== context.tenantId) {
        throw new TenantContextConflictError(active.context.tenantId, context.tenantId);
      }
      if (!sameExecutionIdentity(active.context, context)) {
        throw new TenantExecutionIdentityConflictError();
      }

      return work(active.session);
    }

    return this.prisma.$transaction(async (transaction) => {
      const authorized = isAuthorized(context)
        ? requireAuthorizedTenantExecutionContext(context)
        : undefined;
      if (authorized) {
        const users = await transaction.$queryRawUnsafe<readonly LockedUserAuthorityRow[]>(
          `SELECT
             "status"::text AS "status",
             "authorization_version" AS "authorizationVersion"
           FROM "users"
           WHERE "id" = $1::uuid
           FOR SHARE`,
          authorized.actorId,
        );
        const user = users[0];
        if (
          !user ||
          users.length !== 1 ||
          user.status !== "active" ||
          user.authorizationVersion !== authorized.authorization.userAuthorizationVersion
        ) {
          throw new TenantAuthorizationStaleError();
        }
      }

      await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${APPLICATION_DATABASE_ROLE}`);
      await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${context.tenantId}, true)`;

      if (authorized) {
        const memberships = await transaction.$queryRawUnsafe<
          readonly LockedMembershipAuthorityRow[]
        >(
          `SELECT
             "id",
             "authorization_version" AS "authorizationVersion"
           FROM "tenant_memberships"
           WHERE "tenant_id" = $1::uuid
             AND "user_id" = $2::uuid
             AND "status" = 'active'::tenant_membership_status
           FOR SHARE`,
          context.tenantId,
          authorized.actorId,
        );
        const membership = memberships[0];
        if (
          !membership ||
          memberships.length !== 1 ||
          membership.id !== authorized.authorization.membershipId ||
          membership.authorizationVersion !==
            authorized.authorization.membershipAuthorizationVersion
        ) {
          throw new TenantAuthorizationStaleError();
        }
      }

      const session = this.sessionFactory.create(transaction, context.tenantId);
      if (authorized) {
        const current = await session.authorization.loadActiveTenantAuthorization(
          authorized.actorId,
        );
        if (
          !current ||
          current.membershipId !== authorized.authorization.membershipId ||
          current.membershipAuthorizationVersion !==
            authorized.authorization.membershipAuthorizationVersion ||
          !sameValues(current.roleKeys, authorized.authorization.roleKeys) ||
          !sameValues(current.permissionKeys, authorized.authorization.permissionKeys)
        ) {
          throw new TenantAuthorizationStaleError();
        }
      }
      const activeSession: ActiveTenantSession = Object.freeze({ context, session });

      return this.activeSessions.run(activeSession, () => work(session));
    });
  }
}
