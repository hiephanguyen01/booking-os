import type { SystemRole } from "@booking-os/auth";

import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";

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

export class AcceptInvitationUseCase {
  constructor(
    _transactions: TenantTransactionPort,
    _tokens: InvitationAcceptanceTokenPort,
    _clock: () => Date = () => new Date(),
  ) {}

  async execute(_command: AcceptInvitationCommand): Promise<AcceptInvitationResult> {
    throw new Error("Invitation acceptance is not implemented.");
  }
}
