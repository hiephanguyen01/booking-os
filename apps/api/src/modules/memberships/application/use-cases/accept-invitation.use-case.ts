import type { SystemRole } from "@booking-os/auth";

import type {
  TenantDataSession,
  TenantTransactionPort,
} from "../../../tenancy/application/ports/tenant-transaction.port.js";
import { InvitationInvalidOrExpiredError } from "../../domain/membership-errors.js";
import { isPendingInvitationAvailable } from "../../domain/membership-invitation.js";
import type { SessionElevationPort } from "../ports/session-elevation.port.js";

export interface ParsedMembershipInvitationToken {
  readonly selector: string;
  readonly secret: string;
}

export interface VerifyMembershipInvitationTokenInput {
  readonly secret: string;
  readonly expectedTokenHash: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly normalizedEmail: string;
  readonly intendedRoleKey: SystemRole;
}

export interface InvitationAcceptanceTokenPort {
  parse(serialized: string): ParsedMembershipInvitationToken | null;
  verify(input: VerifyMembershipInvitationTokenInput): boolean;
}

export interface AcceptInvitationCommand {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly hostname: string;
  readonly token: string;
  readonly requestId: string;
}

export interface AcceptInvitationResult {
  readonly accepted: true;
  readonly rotatedSessionToken: string;
}

type InvitationAcceptanceDataSession = TenantDataSession & {
  readonly sessions: SessionElevationPort;
};

export class AcceptInvitationUseCase {
  constructor(
    private readonly transactions: TenantTransactionPort,
    private readonly tokens: InvitationAcceptanceTokenPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: AcceptInvitationCommand): Promise<AcceptInvitationResult> {
    const parsedToken = this.tokens.parse(command.token);
    if (!parsedToken) {
      throw new InvitationInvalidOrExpiredError();
    }

    const now = this.clock();

    return this.transactions.run(
      {
        tenantId: command.tenantId,
        actorId: command.userId,
        requestId: command.requestId,
        traceId: command.requestId,
        source: "console",
      },
      async (tenantSession) => {
        const session = tenantSession as InvitationAcceptanceDataSession;
        const invitation = await session.invitations.lockBySelector(parsedToken.selector);

        if (
          !isPendingInvitationAvailable(invitation, now) ||
          invitation.tenantId !== command.tenantId ||
          invitation.invitedUserId !== command.userId ||
          invitation.hostname !== command.hostname ||
          !this.tokens.verify({
            secret: parsedToken.secret,
            expectedTokenHash: invitation.tokenHash,
            tenantId: command.tenantId,
            userId: command.userId,
            hostname: command.hostname,
            normalizedEmail: invitation.normalizedEmail,
            intendedRoleKey: invitation.intendedRoleKey,
          })
        ) {
          throw new InvitationInvalidOrExpiredError();
        }

        const membership = await session.memberships.findByUserId(command.userId);
        if (!membership || membership.tenantId !== command.tenantId) {
          throw new InvitationInvalidOrExpiredError();
        }

        const lockedMembership = await session.memberships.lockById(membership.id);
        if (lockedMembership?.status !== "invited") {
          throw new InvitationInvalidOrExpiredError();
        }

        await session.memberships.activate(lockedMembership.id, now);
        await session.roles.assign({
          userId: command.userId,
          roleKey: invitation.intendedRoleKey,
          now,
        });
        const authorizationVersion = await session.memberships.incrementAuthorizationVersion(
          lockedMembership.id,
          now,
        );

        if (invitation.intendedRoleKey === "tenant_owner") {
          const tenant = await session.tenants.lockCurrent();
          if (!tenant || tenant.id !== command.tenantId || tenant.status !== "provisioning") {
            throw new InvitationInvalidOrExpiredError();
          }
          await session.tenants.activate(now);
        }

        await session.invitations.accept(invitation.id, now);
        const elevatedSession = await session.sessions.elevateInvitationSession({
          sessionId: command.sessionId,
          membershipAuthorizationVersion: authorizationVersion,
          now,
        });
        await session.audit.append({
          eventType: "membership.invitation.accepted",
          actorUserId: command.userId,
          subjectUserId: command.userId,
          requestId: command.requestId,
          metadata: {
            membershipId: lockedMembership.id,
            invitationId: invitation.id,
            intendedRoleKey: invitation.intendedRoleKey,
          },
          occurredAt: now,
        });

        return Object.freeze({
          accepted: true as const,
          rotatedSessionToken: elevatedSession.rotatedToken,
        });
      },
    );
  }
}
