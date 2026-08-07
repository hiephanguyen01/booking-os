import { encryptSensitiveEnvelope } from "@booking-os/auth";

import type {
  SealTenantAdminInvitationInput,
  TenantAdminInvitationEnvelopePort,
  TenantAdminInvitationEnvelopeValue,
} from "../../application/ports/tenant-admin-invitation-envelope.port.js";

const encoder = new TextEncoder();

export class AesTenantAdminInvitationEnvelopeAdapter
  implements TenantAdminInvitationEnvelopePort
{
  private readonly keyring: Readonly<Record<string, Uint8Array>>;

  constructor(
    private readonly activeKeyId: string,
    keyring: Readonly<Record<string, Uint8Array>>,
  ) {
    const copiedKeyring = Object.fromEntries(
      Object.entries(keyring).map(([keyId, key]) => [keyId, Buffer.from(key)]),
    );
    if (!Object.hasOwn(copiedKeyring, activeKeyId)) {
      throw new Error("The active tenant-admin invitation envelope key is unavailable.");
    }
    this.keyring = Object.freeze(copiedKeyring);
  }

  seal(input: SealTenantAdminInvitationInput): TenantAdminInvitationEnvelopeValue {
    const key = this.keyring[this.activeKeyId];
    if (!key) throw new Error("The active tenant-admin invitation envelope key is unavailable.");

    return encryptSensitiveEnvelope({
      keyId: this.activeKeyId,
      key,
      plaintext: encoder.encode(JSON.stringify({ token: input.serializedToken })),
      aad: encoder.encode(
        [
          "booking-os:membership-email:v1",
          "membership.admin_invitation.requested.v1",
          input.eventId,
          input.tenantId,
          input.invitationId,
          input.userId,
          input.hostname,
          input.normalizedEmail,
          "tenant_admin",
        ].join("\0"),
      ),
    });
  }
}
