import { AsyncLocalStorage } from "node:async_hooks";

import type { TenantExecutionContext } from "@booking-os/contracts";
import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  TenantDataSession,
  TenantTransactionPort,
} from "../../../application/ports/tenant-transaction.port.js";
import {
  InvalidTenantContextError,
  TenantContextConflictError,
} from "../../../application/tenant-context.errors.js";
import { isTenantId } from "../../../domain/tenant-id.js";
import { PrismaTenantProbeRepositoryAdapter } from "./prisma-tenant-probe-repository.adapter.js";

const APPLICATION_DATABASE_ROLE = "booking_app";

interface ActiveTenantSession {
  readonly context: TenantExecutionContext;
  readonly session: TenantDataSession;
}

@Injectable()
export class PrismaTenantTransactionAdapter implements TenantTransactionPort {
  private readonly activeSessions = new AsyncLocalStorage<ActiveTenantSession>();
  private readonly prisma: PrismaService;

  constructor(@Inject(PrismaService) prisma: PrismaService) {
    this.prisma = prisma;
  }

  async run<T>(
    context: TenantExecutionContext,
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

      return work(active.session);
    }

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${APPLICATION_DATABASE_ROLE}`);
      await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${context.tenantId}, true)`;

      const session: TenantDataSession = Object.freeze({
        tenantProbes: new PrismaTenantProbeRepositoryAdapter(transaction),
      });
      const activeSession: ActiveTenantSession = Object.freeze({ context, session });

      return this.activeSessions.run(activeSession, () => work(session));
    });
  }
}
