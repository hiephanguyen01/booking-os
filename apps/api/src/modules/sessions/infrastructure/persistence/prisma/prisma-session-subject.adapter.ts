import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  LoginSessionSubject,
  ResolveLoginSubjectInput,
  SessionSubjectPort,
} from "../../../application/ports/session-subject.port.js";

@Injectable()
export class PrismaSessionSubjectAdapter implements SessionSubjectPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveForLogin(input: ResolveLoginSubjectInput): Promise<LoginSessionSubject | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { status: true, authorizationVersion: true },
    });
    if (user?.status !== "active") {
      return null;
    }

    const assignment = await this.prisma.roleAssignment.findFirst({
      where:
        input.scope.type === "platform"
          ? {
              userId: input.userId,
              scopeLevel: "platform",
              tenantId: null,
              revokedAt: null,
            }
          : {
              userId: input.userId,
              scopeLevel: "tenant",
              tenantId: input.scope.tenantId,
              revokedAt: null,
            },
      select: { id: true },
    });
    if (!assignment) {
      return null;
    }

    const membership =
      input.scope.type === "tenant"
        ? await this.prisma.tenantMembership.findUnique({
            where: {
              tenantId_userId: { tenantId: input.scope.tenantId, userId: input.userId },
              status: "active",
            },
            select: { authorizationVersion: true },
          })
        : null;
    if (input.scope.type === "tenant" && !membership) return null;

    return {
      authorizationVersion: user.authorizationVersion,
      state: "active",
      ...(membership ? { membershipAuthorizationVersion: membership.authorizationVersion } : {}),
    };
  }

  async currentAuthorizationVersion(userId: string): Promise<number | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, authorizationVersion: true },
    });
    return user?.status === "active" ? user.authorizationVersion : null;
  }

  async currentMembershipAuthorizationVersion(
    userId: string,
    tenantId: string,
  ): Promise<number | null> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { status: true, authorizationVersion: true },
    });
    return membership?.status === "active" || membership?.status === "invited"
      ? membership.authorizationVersion
      : null;
  }
}
