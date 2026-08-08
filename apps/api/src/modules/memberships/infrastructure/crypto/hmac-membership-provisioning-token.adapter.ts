import {
  createOneTimeToken,
  parseOneTimeToken,
  type ParsedOneTimeToken,
  verifyOneTimeTokenSecret,
} from "@booking-os/auth";

import type {
  IssuedMembershipInvitationToken,
  MembershipInvitationTokenPort,
} from "../../application/ports/membership-invitation-token.port.js";
import type {
  IssuedTenantActivationToken,
  TenantActivationTokenPort,
} from "../../application/ports/tenant-activation-token.port.js";

interface VerifyMembershipInvitationTokenInput {
  readonly secret: string;
  readonly expectedTokenHash: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly normalizedEmail: string;
  readonly intendedRoleKey: string;
}

function membershipInvitationPurpose(input: {
  readonly tenantId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly normalizedEmail: string;
  readonly intendedRoleKey: string;
}): string {
  return [
    "membership.invitation.v1",
    input.tenantId,
    input.userId,
    input.hostname,
    input.normalizedEmail,
    input.intendedRoleKey,
  ].join(":");
}

function tenantActivationPurpose(tenantId: string, hostname: string): string {
  return `identity.activation.v1:tenant:${tenantId}:${hostname}`;
}

function issue(
  pepper: Uint8Array,
  purpose: string,
): IssuedMembershipInvitationToken | IssuedTenantActivationToken {
  const token = createOneTimeToken({ pepper, purpose });

  return Object.freeze({
    selector: token.selector,
    serialized: token.serialized,
    tokenHash: token.secretDigest,
  });
}

export class HmacMembershipInvitationTokenAdapter implements MembershipInvitationTokenPort {
  private readonly pepper: Uint8Array;

  constructor(pepper: Uint8Array) {
    this.pepper = Buffer.from(pepper);
  }

  issue(
    input: Parameters<MembershipInvitationTokenPort["issue"]>[0],
  ): IssuedMembershipInvitationToken {
    return issue(this.pepper, membershipInvitationPurpose(input));
  }

  parse(serialized: string): ParsedOneTimeToken | null {
    return parseOneTimeToken(serialized);
  }

  verify(input: VerifyMembershipInvitationTokenInput): boolean {
    return verifyOneTimeTokenSecret({
      pepper: this.pepper,
      purpose: membershipInvitationPurpose(input),
      secret: input.secret,
      expectedDigest: input.expectedTokenHash,
    });
  }
}

export class HmacTenantActivationTokenAdapter implements TenantActivationTokenPort {
  private readonly pepper: Uint8Array;

  constructor(pepper: Uint8Array) {
    this.pepper = Buffer.from(pepper);
  }

  issue(input: Parameters<TenantActivationTokenPort["issue"]>[0]): IssuedTenantActivationToken {
    return issue(this.pepper, tenantActivationPurpose(input.tenantId, input.hostname));
  }
}
