import { PasswordPolicyError, assertPasswordPolicy } from "@booking-os/auth";

import type { IdentityScopeType } from "../../domain/user.js";
import type { IdentityEmailTemplate } from "../ports/identity-outbox.port.js";
import type { PasswordDenylistPort } from "../ports/password-denylist.port.js";

const encoder = new TextEncoder();

export type IdentityTokenKind = "activation" | "password_reset";

export function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();

  if (normalized.length === 0) {
    throw new TypeError("Identity hostname cannot be empty.");
  }

  return normalized;
}

export function resolveTenantId(
  scopeType: IdentityScopeType,
  tenantId: string | undefined,
): string | null {
  if (scopeType === "platform") {
    if (tenantId !== undefined) {
      throw new TypeError("Platform identity scope cannot include a tenant ID.");
    }
    return null;
  }

  const normalized = tenantId?.trim();
  if (!normalized) {
    throw new TypeError("Tenant identity scope requires a tenant ID.");
  }
  return normalized;
}

export function identityTokenPurpose(
  kind: IdentityTokenKind,
  scopeType: IdentityScopeType,
  tenantId: string | null,
  hostname: string,
): string {
  return `identity.${kind}.v1:${scopeType}:${tenantId ?? "-"}:${hostname}`;
}

export function identityEmailAssociatedData(input: {
  readonly eventType: string;
  readonly eventId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly recipient: string;
  readonly template: IdentityEmailTemplate;
}): Uint8Array {
  return encoder.encode(
    [
      "booking-os:identity-email:v1",
      input.eventType,
      input.eventId,
      input.userId,
      input.hostname,
      input.recipient,
      input.template,
    ].join("\0"),
  );
}

export async function validateNewPassword(
  password: string,
  denylist: PasswordDenylistPort,
): Promise<string> {
  const normalized = assertPasswordPolicy(password);

  if (await denylist.contains(normalized)) {
    throw new PasswordPolicyError("common_password");
  }

  return normalized;
}
