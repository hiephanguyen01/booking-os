import { encryptSensitiveEnvelope } from "@booking-os/auth";

import type {
  InitialOwnerOnboardingEnvelopePort,
  InitialOwnerOnboardingEnvelopeValue,
  SealInitialOwnerOnboardingInput,
} from "../../application/ports/initial-owner-onboarding-envelope.port.js";
import type {
  MembershipInvitationEnvelopePort,
  MembershipInvitationEnvelopeValue,
  SealMembershipInvitationInput,
} from "../../application/ports/membership-invitation-envelope.port.js";
import type {
  SealTenantActivationInput,
  TenantActivationEnvelopePort,
  TenantActivationEnvelopeValue,
} from "../../application/ports/tenant-activation-envelope.port.js";

const encoder = new TextEncoder();

type EnvelopeValue = MembershipInvitationEnvelopeValue;

class AesEnvelope {
  private readonly keyring: Readonly<Record<string, Uint8Array>>;

  constructor(
    private readonly activeKeyId: string,
    keyring: Readonly<Record<string, Uint8Array>>,
  ) {
    const copiedKeyring = Object.fromEntries(
      Object.entries(keyring).map(([keyId, key]) => [keyId, Buffer.from(key)]),
    );

    if (!Object.hasOwn(copiedKeyring, activeKeyId)) {
      throw new Error("The active membership-provisioning envelope key is unavailable.");
    }

    this.keyring = Object.freeze(copiedKeyring);
  }

  protected sealEnvelope(associatedData: string, plaintext: unknown): EnvelopeValue {
    const key = this.keyring[this.activeKeyId];

    if (!key) {
      throw new Error("The active membership-provisioning envelope key is unavailable.");
    }

    return encryptSensitiveEnvelope({
      keyId: this.activeKeyId,
      key,
      plaintext: encoder.encode(JSON.stringify(plaintext)),
      aad: encoder.encode(associatedData),
    });
  }
}

export class AesMembershipInvitationEnvelopeAdapter
  extends AesEnvelope
  implements MembershipInvitationEnvelopePort
{
  seal(input: SealMembershipInvitationInput): MembershipInvitationEnvelopeValue {
    return super.sealEnvelope(
      [
        "booking-os:membership-email:v1",
        "membership.owner_invitation.requested.v1",
        input.eventId,
        input.tenantId,
        input.invitationId,
        input.userId,
        input.hostname,
        input.normalizedEmail,
        input.intendedRoleKey,
      ].join("\0"),
      { token: input.serializedToken },
    );
  }
}

export class AesInitialOwnerOnboardingEnvelopeAdapter
  extends AesEnvelope
  implements InitialOwnerOnboardingEnvelopePort
{
  seal(input: SealInitialOwnerOnboardingInput): InitialOwnerOnboardingEnvelopeValue {
    return super.sealEnvelope(
      [
        "booking-os:owner-onboarding-email:v1",
        "membership.owner_onboarding.requested.v1",
        input.eventId,
        input.tenantId,
        input.invitationId,
        input.userId,
        input.hostname,
        input.recipient,
      ].join("\0"),
      {
        activationToken: input.activationToken,
        invitationToken: input.invitationToken,
      },
    );
  }
}

export class AesTenantActivationEnvelopeAdapter
  extends AesEnvelope
  implements TenantActivationEnvelopePort
{
  seal(input: SealTenantActivationInput): TenantActivationEnvelopeValue {
    return super.sealEnvelope(
      [
        "booking-os:identity-email:v1",
        "identity.activation.requested.v1",
        input.eventId,
        input.userId,
        input.hostname,
        input.recipient,
        "account_activation",
      ].join("\0"),
      { token: input.serializedToken },
    );
  }
}
