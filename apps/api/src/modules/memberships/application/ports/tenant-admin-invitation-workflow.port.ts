import type { SystemRole } from "@booking-os/auth";

export interface InviteTenantAdminWorkflowInput {
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly hostname: string;
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly requestId: string;
  readonly now: Date;
}

export interface ResendTenantAdminInvitationWorkflowInput {
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly hostname: string;
  readonly invitationId: string;
  readonly requestId: string;
  readonly now: Date;
}

export interface GetCurrentInvitationWorkflowInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly now: Date;
}

export interface CurrentInvitationWorkflowResult {
  readonly id: string;
  readonly tenantId: string;
  readonly invitedUserId: string;
  readonly intendedRoleKey: SystemRole;
  readonly hostname: string;
  readonly expiresAt: Date;
}

export interface TenantAdminInvitationWorkflowPort {
  inviteTenantAdmin(input: InviteTenantAdminWorkflowInput): Promise<{ readonly accepted: true }>;
  resendInvitation(
    input: ResendTenantAdminInvitationWorkflowInput,
  ): Promise<{ readonly accepted: true }>;
  getCurrentInvitation(
    input: GetCurrentInvitationWorkflowInput,
  ): Promise<CurrentInvitationWorkflowResult | null>;
}
