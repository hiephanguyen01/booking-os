import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
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
import { EnvironmentService } from "../../../../config/environment.service.js";
import { SessionCsrfGuard } from "../../../sessions/infrastructure/http/session-csrf.guard.js";
import { SessionRequired } from "../../../sessions/infrastructure/http/session-required.decorator.js";
import {
  BuildPlatformAuthorizationContextUseCase,
  PlatformAuthorizationDeniedError,
} from "../../application/use-cases/build-platform-authorization-context.use-case.js";
import { GetTenantProvisioningUseCase } from "../../application/use-cases/get-tenant-provisioning.use-case.js";
import {
  PlatformTenantProvisioningError,
  ProvisionTenantUseCase,
} from "../../application/use-cases/provision-tenant.use-case.js";
import { ResendOwnerInvitationUseCase } from "../../application/use-cases/resend-owner-invitation.use-case.js";
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

function requireNonEmpty(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(`${field} is required.`);
  return normalized;
}

@SupportedApi()
@ApiTags("platform-tenants")
@UseGuards(SessionCsrfGuard)
@Controller("platform/tenants")
export class PlatformTenantsController {
  constructor(
    @Inject(RequestContextStorage) private readonly requestContext: RequestContextStorage,
    @Inject(BuildPlatformAuthorizationContextUseCase)
    private readonly authorization: BuildPlatformAuthorizationContextUseCase,
    @Inject(ProvisionTenantUseCase) private readonly provision: ProvisionTenantUseCase,
    @Inject(GetTenantProvisioningUseCase)
    private readonly getProvisioning: GetTenantProvisioningUseCase,
    @Inject(ResendOwnerInvitationUseCase) private readonly resend: ResendOwnerInvitationUseCase,
    @Inject(EnvironmentService)
    private readonly environment: Pick<EnvironmentService, "trustProxy">,
  ) {}

  @SessionRequired()
  @Post()
  @ApiOperation({ operationId: "provisionPlatformTenant" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ProvisionTenantRequestDto })
  @ApiOkResponse({ type: TenantProvisioningResponseDto })
  async create(
    @Body() body: ProvisionTenantRequestDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: PlatformTenantRequest,
  ) {
    const authenticated = this.requestContext.requireAuthenticated();
    const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
    if (!hostname) throw new BadRequestException("A valid host is required.");
    const authorization = await this.buildAuthorization(authenticated);
    return this.provision.execute({
      authorization,
      hostname,
      idempotencyKey: requireNonEmpty(idempotencyKey, "Idempotency-Key"),
      slug: requireNonEmpty(body.slug, "slug"),
      tenantName: requireNonEmpty(body.tenantName, "tenantName"),
      ownerEmail: requireNonEmpty(body.ownerEmail, "ownerEmail"),
      requestId: authenticated.requestId,
    });
  }

  @SessionRequired()
  @Get(":tenantId")
  @ApiOperation({ operationId: "getPlatformTenantProvisioning" })
  @ApiParam({ name: "tenantId", type: String, format: "uuid" })
  @ApiOkResponse({ type: TenantProvisioningResponseDto })
  async get(@Param("tenantId") tenantId: string, @Req() request: PlatformTenantRequest) {
    const authenticated = this.requestContext.requireAuthenticated();
    const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
    if (!hostname) throw new BadRequestException("A valid host is required.");
    return this.getProvisioning.execute({
      authorization: await this.buildAuthorization(authenticated),
      hostname,
      tenantId: requireNonEmpty(tenantId, "tenantId"),
    });
  }

  @SessionRequired()
  @Post(":tenantId/owner-invitation/resend")
  @HttpCode(202)
  @ApiOperation({ operationId: "resendPlatformTenantOwnerInvitation" })
  @ApiParam({ name: "tenantId", type: String, format: "uuid" })
  @ApiOkResponse({ type: OwnerInvitationResendResponseDto })
  async resendOwnerInvitation(
    @Param("tenantId") tenantId: string,
    @Req() request: PlatformTenantRequest,
  ) {
    const authenticated = this.requestContext.requireAuthenticated();
    const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
    if (!hostname) throw new BadRequestException("A valid host is required.");
    return this.resend.execute({
      authorization: await this.buildAuthorization(authenticated),
      hostname,
      tenantId: requireNonEmpty(tenantId, "tenantId"),
      requestId: authenticated.requestId,
    });
  }

  private async buildAuthorization(
    authenticated: ReturnType<RequestContextStorage["requireAuthenticated"]>,
  ) {
    try {
      return await this.authorization.execute(authenticated);
    } catch (error: unknown) {
      if (error instanceof PlatformAuthorizationDeniedError) {
        throw new ForbiddenException("Platform authorization is required.");
      }
      if (error instanceof PlatformTenantProvisioningError) {
        throw new ForbiddenException("Platform authorization is required.");
      }
      throw error;
    }
  }
}
