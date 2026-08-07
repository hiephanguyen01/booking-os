import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type {
  GetPlatformTenantProvisioningResult,
  PlatformTenantProvisioningQueryPort,
} from "../ports/platform-tenant-provisioning-workflow.port.js";
import {
  type PlatformTenantProvisioningConfig,
  PlatformTenantProvisioningError,
} from "./provision-tenant.use-case.js";

export type GetTenantProvisioningCommand = Readonly<{
  authorization: AuthorizationContext;
  hostname: string;
  tenantId: string;
}>;

function canonicalHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export class GetTenantProvisioningUseCase {
  constructor(
    private readonly query: PlatformTenantProvisioningQueryPort,
    private readonly config: Pick<PlatformTenantProvisioningConfig, "platformHostname">,
  ) {}

  async execute(
    command: GetTenantProvisioningCommand,
  ): Promise<GetPlatformTenantProvisioningResult> {
    if (command.authorization.scope.type !== "platform") {
      throw new PlatformTenantProvisioningError(
        "PLATFORM_SCOPE_REQUIRED",
        "Tenant provisioning status requires a platform authorization scope.",
      );
    }

    if (!command.authorization.permissionKeys.includes(PERMISSION_KEYS.platformTenantsProvision)) {
      throw new PlatformTenantProvisioningError(
        "PLATFORM_PERMISSION_REQUIRED",
        "Tenant provisioning status requires the platform tenant provisioning permission.",
      );
    }

    if (canonicalHostname(command.hostname) !== canonicalHostname(this.config.platformHostname)) {
      throw new PlatformTenantProvisioningError(
        "PLATFORM_HOST_REQUIRED",
        "Tenant provisioning status is only available on the primary platform hostname.",
      );
    }

    return this.query.getProvisioning({
      actorUserId: command.authorization.userId,
      tenantId: command.tenantId,
    });
  }
}
