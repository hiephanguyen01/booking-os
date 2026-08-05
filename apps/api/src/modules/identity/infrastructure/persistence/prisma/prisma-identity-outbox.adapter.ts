import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../../database/prisma.service.js";
import { OutboxRepository } from "../../../../../reliability/outbox.repository.js";
import type {
  IdentityOutboxPort,
  IssueActivationEmailInput,
  IssuePasswordResetEmailInput,
} from "../../../application/ports/identity-outbox.port.js";

@Injectable()
export class PrismaIdentityOutboxAdapter implements IdentityOutboxPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OutboxRepository) private readonly outbox: OutboxRepository,
  ) {}

  async issueActivation(input: IssueActivationEmailInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.accountActivationToken.updateMany({
        where: {
          userId: input.token.userId,
          scopeType: input.token.scopeType,
          tenantId: input.token.tenantId,
          hostname: input.token.hostname,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: input.token.createdAt },
      });
      await transaction.accountActivationToken.create({ data: { ...input.token } });
      await this.outbox.append(transaction, {
        id: input.event.id,
        tenantId: input.event.tenantId,
        type: input.event.type,
        aggregateType: input.event.aggregateType,
        aggregateId: input.event.aggregateId,
        payload: input.event.payload as unknown as Prisma.InputJsonValue,
        occurredAt: input.event.occurredAt,
      });
    });
  }

  async issuePasswordReset(input: IssuePasswordResetEmailInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.passwordResetToken.updateMany({
        where: {
          userId: input.token.userId,
          scopeType: input.token.scopeType,
          tenantId: input.token.tenantId,
          hostname: input.token.hostname,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: input.token.createdAt },
      });
      await transaction.passwordResetToken.create({ data: { ...input.token } });
      await this.outbox.append(transaction, {
        id: input.event.id,
        tenantId: input.event.tenantId,
        type: input.event.type,
        aggregateType: input.event.aggregateType,
        aggregateId: input.event.aggregateId,
        payload: input.event.payload as unknown as Prisma.InputJsonValue,
        occurredAt: input.event.occurredAt,
      });
    });
  }
}
