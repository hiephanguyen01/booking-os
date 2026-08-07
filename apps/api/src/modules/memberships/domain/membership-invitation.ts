import type { SystemRole } from "@booking-os/auth";

export const MEMBERSHIP_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const;

export type MembershipInvitationStatus = (typeof MEMBERSHIP_INVITATION_STATUSES)[number];

export interface MembershipInvitation {
  readonly id: string;
  readonly tenantId: string;
  readonly normalizedEmail: string;
  readonly invitedUserId: string | null;
  readonly intendedRoleKey: SystemRole;
  readonly status: MembershipInvitationStatus;
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly invitedByUserId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function isPendingInvitationAvailable(
  invitation: MembershipInvitation | null | undefined,
  now: Date,
): invitation is MembershipInvitation & { readonly status: "pending" } {
  return (
    invitation?.status === "pending" &&
    invitation.revokedAt === null &&
    invitation.acceptedAt === null &&
    invitation.expiresAt.getTime() > now.getTime()
  );
}
