import type { SystemRole } from "@booking-os/auth";

export interface IssueMembershipInvitationTokenInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly normalizedEmail: string;
  readonly intendedRoleKey: SystemRole;
}

export interface IssuedMembershipInvitationToken {
  readonly selector: string;
  readonly serialized: string;
  readonly tokenHash: string;
}

export interface MembershipInvitationTokenPort {
  issue(input: IssueMembershipInvitationTokenInput): IssuedMembershipInvitationToken;
}
