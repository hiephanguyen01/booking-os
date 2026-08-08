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

export interface ParsedMembershipInvitationToken {
  readonly selector: string;
  readonly secret: string;
}

export interface VerifyMembershipInvitationTokenInput extends IssueMembershipInvitationTokenInput {
  readonly secret: string;
  readonly expectedTokenHash: string;
}

export interface MembershipInvitationTokenPort {
  issue(input: IssueMembershipInvitationTokenInput): IssuedMembershipInvitationToken;
  parse(serialized: string): ParsedMembershipInvitationToken | null;
  verify(input: VerifyMembershipInvitationTokenInput): boolean;
}
