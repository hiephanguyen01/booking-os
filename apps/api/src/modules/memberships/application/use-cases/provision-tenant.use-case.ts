import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type {
  PlatformTenantProvisioningWorkflowPort,
  ProvisionPlatformTenantResult,
} from "../ports/platform-tenant-provisioning-workflow.port.js";

export type PlatformTenantProvisioningErrorCode =
  | "PLATFORM_SCOPE_REQUIRED"
  | "PLATFORM_PERMISSION_REQUIRED"
  | "PLATFORM_HOST_REQUIRED"
  | "TENANT_SLUG_INVALID";

export class PlatformTenantProvisioningError extends Error {
  constructor(
    readonly code: PlatformTenantProvisioningErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlatformTenantProvisioningError";
  }
}

export type PlatformTenantProvisioningConfig = Readonly<{
  platformHostname: string;
  tenantBaseDomain: string;
  reservedTenantSlugs: readonly string[];
}>;

export type ProvisionTenantCommand = Readonly<{
  authorization: AuthorizationContext;
  hostname: string;
  idempotencyKey: string;
  slug: string;
  tenantName: string;
  ownerEmail: string;
  requestId: string;
}>;

const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function canonicalHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizeTenantBaseDomain(value: string): string {
  return canonicalHostname(value).replace(/^\./, "");
}

function requireTenantSlug(slug: string, reservedSlugs: readonly string[]): string {
  const normalizedSlug = slug.trim().toLowerCase();
  const reserved = new Set(reservedSlugs.map((entry) => entry.trim().toLowerCase()));

  if (
    slug !== normalizedSlug ||
    !TENANT_SLUG_PATTERN.test(normalizedSlug) ||
    reserved.has(normalizedSlug)
  ) {
    throw new PlatformTenantProvisioningError(
      "TENANT_SLUG_INVALID",
      "Tenant slug must be a canonical, non-reserved DNS label.",
    );
  }

  return normalizedSlug;
}

export class ProvisionTenantUseCase {
  constructor(
    private readonly workflow: PlatformTenantProvisioningWorkflowPort,
    private readonly config: PlatformTenantProvisioningConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: ProvisionTenantCommand): Promise<ProvisionPlatformTenantResult> {
    if (command.authorization.scope.type !== "platform") {
      throw new PlatformTenantProvisioningError(
        "PLATFORM_SCOPE_REQUIRED",
        "Tenant provisioning requires a platform authorization scope.",
      );
    }

    if (!command.authorization.permissionKeys.includes(PERMISSION_KEYS.platformTenantsProvision)) {
      throw new PlatformTenantProvisioningError(
        "PLATFORM_PERMISSION_REQUIRED",
        "Tenant provisioning requires the platform tenant provisioning permission.",
      );
    }

    if (canonicalHostname(command.hostname) !== canonicalHostname(this.config.platformHostname)) {
      throw new PlatformTenantProvisioningError(
        "PLATFORM_HOST_REQUIRED",
        "Tenant provisioning is only available on the primary platform hostname.",
      );
    }

    const slug = requireTenantSlug(command.slug, this.config.reservedTenantSlugs);
    const normalizedOwnerEmail = command.ownerEmail.trim().toLowerCase();
    const tenantBaseDomain = normalizeTenantBaseDomain(this.config.tenantBaseDomain);

    return this.workflow.provision({
      actorUserId: command.authorization.userId,
      idempotencyKey: command.idempotencyKey,
      slug,
      tenantName: command.tenantName,
      ownerEmail: command.ownerEmail,
      normalizedOwnerEmail,
      tenantHostname: `${slug}.${tenantBaseDomain}`,
      requestId: command.requestId,
      now: this.clock(),
    });
  }
}
