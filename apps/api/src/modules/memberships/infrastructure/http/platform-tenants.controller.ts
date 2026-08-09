import type { AuthorizationContext } from "@booking-os/contracts";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";

import { SupportedApi } from "../../../../api-visibility/api-visibility.decorator.js";
import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import type { RequestHeaders } from "../../../../common/request-context/request-context.types.js";
import { SessionCsrfGuard } from "../../../../common/security/session-csrf.guard.js";
import { SessionRequired } from "../../../../common/security/session-required.decorator.js";
import { EnvironmentService } from "../../../../config/environment.service.js";
import {
  CurrentAuthorizationContext,
  PermissionGuard,
  RequiresPermission,
} from "../../../authorization/authorization.http.js";
import { GetTenantProvisioningUseCase } from "../../application/use-cases/get-tenant-provisioning.use-case.js";
import {
  PlatformTenantProvisioningError,
  ProvisionTenantUseCase,
} from "../../application/use-cases/provision-tenant.use-case.js";
import { ResendOwnerInvitationUseCase } from "../../application/use-cases/resend-owner-invitation.use-case.js";
import {
  TenantNotAvailableError,
  TenantProvisioningConflictError,
  TenantProvisioningIdempotencyConflictError,
  TenantProvisioningInProgressError,
} from "../../domain/membership-errors.js";
import {
  OwnerInvitationResendResponseDto,
  ProvisionTenantRequestDto,
  TenantProvisioningResponseDto,
} from "./platform-tenants.dto.js";

interface PlatformTenantRequest {
  readonly headers: RequestHeaders;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function effectiveHostname(headers: RequestHeaders, trustProxy: boolean): string | null {
  const forwarded = firstHeaderValue(headers["x-forwarded-host"]);
  const direct = firstHeaderValue(headers.host);
  const selected = trustProxy && forwarded ? forwarded.split(",", 1)[0] : direct;
  const normalized = selected?.trim().toLowerCase();
  if (!normalized) return null;
  const bracketed = /^\[([^\]]+)](?::\d+)?$/.exec(normalized);
  return bracketed?.[1] ?? normalized.replace(/:\d+$/, "");
}

function requireNonEmpty(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : undefined;
  if (!normalized) throw new BadRequestException(`${field} is required.`);
  return normalized;
}

function requireUuid(value: unknown, field: string): string {
  const normalized = requireNonEmpty(value, field);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
  ) {
    throw new BadRequestException(`${field} must be a UUID.`);
  }
  return normalized;
}

function requireEmail(value: unknown, field: string): string {
  const normalized = requireNonEmpty(value, field);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new BadRequestException(`${field} must be an email address.`);
  }
  return normalized;
}

@SupportedApi()
@ApiTags("platform-tenants")
@UseGuards(SessionCsrfGuard, PermissionGuard)
@Controller("platform/tenants")
export class PlatformTenantsController {
  constructor(
    @Inject(RequestContextStorage) private readonly requestContext: RequestContextStorage,
    @Inject(ProvisionTenantUseCase) private readonly provision: ProvisionTenantUseCase,
    @Inject(GetTenantProvisioningUseCase)
    private readonly getProvisioning: GetTenantProvisioningUseCase,
    @Inject(ResendOwnerInvitationUseCase) private readonly resend: ResendOwnerInvitationUseCase,
    @Inject(EnvironmentService)
    private readonly environment: Pick<EnvironmentService, "trustProxy">,
  ) {}

  @SessionRequired()
  @RequiresPermission("platform.tenants.provision")
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "provisionPlatformTenant" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ProvisionTenantRequestDto })
  @ApiOkResponse({ type: TenantProvisioningResponseDto })
  async create(
    @Body() body: ProvisionTenantRequestDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: PlatformTenantRequest,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    const authenticated = this.requestContext.requireAuthenticated();
    const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
    if (!hostname) throw new BadRequestException("A valid host is required.");
    return this.executeProvisioning(() =>
      this.provision.execute({
        authorization,
        hostname,
        idempotencyKey: requireNonEmpty(idempotencyKey, "Idempotency-Key"),
        slug: requireNonEmpty(body?.slug, "slug"),
        tenantName: requireNonEmpty(body?.tenantName, "tenantName"),
        ownerEmail: requireEmail(body?.ownerEmail, "ownerEmail"),
        requestId: authenticated.requestId,
      }),
    );
  }

  @SessionRequired()
  @RequiresPermission("platform.tenants.provision")
  @Get(":tenantId")
  @ApiOperation({ operationId: "getPlatformTenantProvisioning" })
  @ApiParam({ name: "tenantId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantProvisioningResponseDto })
  async get(
    @Param("tenantId") tenantId: string,
    @Req() request: PlatformTenantRequest,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
    if (!hostname) throw new BadRequestException("A valid host is required.");
    return this.executeProvisioning(async () =>
      this.getProvisioning.execute({
        authorization,
        hostname,
        tenantId: requireUuid(tenantId, "tenantId"),
      }),
    );
  }

  @SessionRequired()
  @RequiresPermission("platform.tenants.provision")
  @Post(":tenantId/owner-invitation/resend")
  @HttpCode(202)
  @ApiOperation({ operationId: "resendPlatformTenantOwnerInvitation" })
  @ApiParam({ name: "tenantId", type: String, format: "uuid" })
  @ApiAcceptedResponse({ type: OwnerInvitationResendResponseDto })
  async resendOwnerInvitation(
    @Param("tenantId") tenantId: string,
    @Req() request: PlatformTenantRequest,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ) {
    const authenticated = this.requestContext.requireAuthenticated();
    const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
    if (!hostname) throw new BadRequestException("A valid host is required.");
    return this.executeProvisioning(async () =>
      this.resend.execute({
        authorization,
        hostname,
        tenantId: requireUuid(tenantId, "tenantId"),
        requestId: authenticated.requestId,
      }),
    );
  }

  private async executeProvisioning<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof PlatformTenantProvisioningError) {
        switch (error.code) {
          case "TENANT_SLUG_INVALID":
            throw new BadRequestException("Tenant provisioning input is invalid.");
          case "PLATFORM_HOST_REQUIRED":
            throw new NotFoundException();
          case "PLATFORM_SCOPE_REQUIRED":
          case "PLATFORM_PERMISSION_REQUIRED":
            throw new ForbiddenException("Platform authorization is required.");
        }
      }

      if (error instanceof TenantNotAvailableError) {
        throw new NotFoundException();
      }

      if (
        error instanceof TenantProvisioningConflictError ||
        error instanceof TenantProvisioningIdempotencyConflictError ||
        error instanceof TenantProvisioningInProgressError
      ) {
        throw new ConflictException("Tenant provisioning conflicts with an existing request.");
      }

      throw error;
    }
  }
}
