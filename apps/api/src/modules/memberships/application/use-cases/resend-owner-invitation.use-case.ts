import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type {
  PlatformTenantProvisioningWorkflowPort,
  ResendOwnerInvitationResult,
} from "../ports/platform-tenant-provisioning-workflow.port.js";
import {
  type PlatformTenantProvisioningConfig,
  PlatformTenantProvisioningError,
} from "./provision-tenant.use-case.js";

export type ResendOwnerInvitationCommand = Readonly<{
  authorization: AuthorizationContext;
  hostname: string;
  tenantId: string;
  requestId: string;
}>;

function canonicalHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export class ResendOwnerInvitationUseCase {
  constructor(
    private readonly workflow: PlatformTenantProvisioningWorkflowPort,
    private readonly config: Pick<PlatformTenantProvisioningConfig, "platformHostname">,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: ResendOwnerInvitationCommand): Promise<ResendOwnerInvitationResult> {
    if (command.authorization.scope.type !== "platform") {
      throw new PlatformTenantProvisioningError(
        "PLATFORM_SCOPE_REQUIRED",
        "Owner invitation resend requires a platform authorization scope.",
      );
    }

    if (!command.authorization.permissionKeys.includes(PERMISSION_KEYS.platformTenantsProvision)) {
      throw new PlatformTenantProvisioningError(
        "PLATFORM_PERMISSION_REQUIRED",
        "Owner invitation resend requires the platform tenant provisioning permission.",
      );
    }

    if (canonicalHostname(command.hostname) !== canonicalHostname(this.config.platformHostname)) {
      throw new PlatformTenantProvisioningError(
        "PLATFORM_HOST_REQUIRED",
        "Owner invitation resend is only available on the primary platform hostname.",
      );
    }

    return this.workflow.resendOwnerInvitation({
      actorUserId: command.authorization.userId,
      tenantId: command.tenantId,
      requestId: command.requestId,
      now: this.clock(),
    });
  }
}
