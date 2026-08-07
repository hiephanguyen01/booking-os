import type { SystemRole } from "@booking-os/auth";

import type { MembershipInvitation } from "../../domain/membership-invitation.js";

export interface CreateMembershipInvitationInput {
  readonly normalizedEmail: string;
  readonly invitedUserId: string | null;
  readonly intendedRoleKey: SystemRole;
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly invitedByUserId: string;
  readonly now: Date;
}

export interface InvitationRepositoryPort {
  findPendingByEmailAndRole(
    normalizedEmail: string,
    intendedRoleKey: SystemRole,
  ): Promise<MembershipInvitation | null>;
  findCurrentForUser(userId: string): Promise<MembershipInvitation | null>;
  lockBySelector(selector: string): Promise<MembershipInvitation | null>;
  create(input: CreateMembershipInvitationInput): Promise<MembershipInvitation>;
  revoke(id: string, now: Date): Promise<void>;
  accept(id: string, now: Date): Promise<void>;
}
