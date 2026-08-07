import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
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
  BuildTenantAuthorizationContextUseCase,
  TenantAuthorizationDeniedError,
} from "../../application/use-cases/build-tenant-authorization-context.use-case.js";
import { GetCurrentInvitationUseCase } from "../../application/use-cases/get-current-invitation.use-case.js";
import { InviteTenantAdminUseCase } from "../../application/use-cases/invite-tenant-admin.use-case.js";
import { ResendInvitationUseCase } from "../../application/use-cases/resend-invitation.use-case.js";
import {
  InvitationInvalidOrExpiredError,
  RoleGrantNotAllowedError,
} from "../../domain/membership-errors.js";
import {
  CreateTenantAdminInvitationRequestDto,
  CurrentTenantInvitationResponseDto,
  TenantInvitationAcceptedResponseDto,
} from "./tenant-invitations.dto.js";

interface TenantInvitationRequest {
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

function requireEmail(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new BadRequestException("email must be an email address.");
  }
  return normalized;
}

function requireUuid(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
  ) {
    throw new BadRequestException("invitationId must be a UUID.");
  }
  return normalized;
}

@SupportedApi()
@ApiTags("membership-invitations")
@UseGuards(SessionCsrfGuard)
@Controller("membership/invitations")
export class TenantInvitationsController {
  constructor(
    @Inject(RequestContextStorage) private readonly requestContext: RequestContextStorage,
    @Inject(BuildTenantAuthorizationContextUseCase)
    private readonly authorization: BuildTenantAuthorizationContextUseCase,
    @Inject(InviteTenantAdminUseCase) private readonly invite: InviteTenantAdminUseCase,
    @Inject(ResendInvitationUseCase) private readonly resendInvitation: ResendInvitationUseCase,
    @Inject(GetCurrentInvitationUseCase)
    private readonly getCurrentInvitation: GetCurrentInvitationUseCase,
    @Inject(EnvironmentService)
    private readonly environment: Pick<EnvironmentService, "trustProxy">,
  ) {}

  @SessionRequired()
  @Get("current")
  @ApiOperation({ operationId: "getCurrentMembershipInvitation" })
  @ApiOkResponse({ type: CurrentTenantInvitationResponseDto })
  async current(@Req() request: TenantInvitationRequest) {
    const authenticated = this.requestContext.requireAuthenticated();
    if (authenticated.authScope.type !== "tenant") throw new NotFoundException();
    const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
    if (!hostname) throw new BadRequestException("A valid host is required.");
    try {
      return await this.getCurrentInvitation.execute({
        tenantId: authenticated.authScope.tenantId,
        userId: authenticated.actorId,
        hostname,
      });
    } catch (error: unknown) {
      if (error instanceof InvitationInvalidOrExpiredError) throw new NotFoundException();
      throw error;
    }
  }

  @SessionRequired()
  @Post()
  @HttpCode(202)
  @ApiOperation({ operationId: "createTenantAdminInvitation" })
  @ApiBody({ type: CreateTenantAdminInvitationRequestDto })
  @ApiAcceptedResponse({ type: TenantInvitationAcceptedResponseDto })
  async create(
    @Body() body: CreateTenantAdminInvitationRequestDto,
    @Req() request: TenantInvitationRequest,
  ) {
    const authenticated = this.requestContext.requireAuthenticated();
    const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
    if (!hostname) throw new BadRequestException("A valid host is required.");
    try {
      return await this.invite.execute({
        authorization: await this.authorization.execute(authenticated),
        hostname,
        email: requireEmail(body?.email),
        requestId: authenticated.requestId,
      });
    } catch (error: unknown) {
      return this.mapMutationError(error);
    }
  }

  @SessionRequired()
  @Post(":invitationId/resend")
  @HttpCode(202)
  @ApiOperation({ operationId: "resendTenantAdminInvitation" })
  @ApiParam({ name: "invitationId", type: String, format: "uuid" })
  @ApiAcceptedResponse({ type: TenantInvitationAcceptedResponseDto })
  async resend(
    @Param("invitationId") invitationId: string,
    @Req() request: TenantInvitationRequest,
  ) {
    const authenticated = this.requestContext.requireAuthenticated();
    const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
    if (!hostname) throw new BadRequestException("A valid host is required.");
    try {
      return await this.resendInvitation.execute({
        authorization: await this.authorization.execute(authenticated),
        hostname,
        invitationId: requireUuid(invitationId),
        requestId: authenticated.requestId,
      });
    } catch (error: unknown) {
      return this.mapMutationError(error);
    }
  }

  private mapMutationError(error: unknown): never {
    if (
      error instanceof TenantAuthorizationDeniedError ||
      error instanceof RoleGrantNotAllowedError
    ) {
      throw new ForbiddenException("Tenant membership administration is required.");
    }
    if (error instanceof InvitationInvalidOrExpiredError) throw new NotFoundException();
    throw error;
  }
}
