import type { AuthorizationContext } from "@booking-os/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
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
  CurrentAuthorizationContext,
  PermissionGuard,
  RequiresPermission,
} from "../../../authorization/authorization.http.js";
import {
  AdminRevokeUserSessionsUseCase,
  AdminSessionRevocationForbiddenError,
} from "../../application/use-cases/admin-revoke-user-sessions.use-case.js";
import {
  PlatformSessionRevocationRequestDto,
  PlatformSessionRevocationResponseDto,
} from "./platform-security.dto.js";

interface PlatformSecurityRequest {
  readonly headers: RequestHeaders;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function effectiveHostname(headers: RequestHeaders, trustProxy: boolean): string | undefined {
  const forwarded = firstHeaderValue(headers["x-forwarded-host"]);
  const direct = firstHeaderValue(headers.host);
  const selected = trustProxy && forwarded ? forwarded.split(",", 1)[0] : direct;
  const normalized = selected?.trim().toLowerCase();
  if (!normalized) return undefined;
  const bracketed = /^\[([^\]]+)](?::\d+)?$/.exec(normalized);
  return bracketed?.[1] ?? normalized.replace(/:\d+$/, "");
}

function requireUuid(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      normalized,
    )
  ) {
    throw new BadRequestException(`${field} must be a UUID.`);
  }
  return normalized;
}

function requireReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason || reason.length > 160) {
    throw new BadRequestException("reason must contain between 1 and 160 characters.");
  }
  return reason;
}

@SupportedApi()
@ApiTags("platform-security")
@UseGuards(SessionCsrfGuard, PermissionGuard)
@Controller("platform/security")
export class PlatformSecurityController {
  constructor(
    @Inject(AdminRevokeUserSessionsUseCase)
    private readonly revokeUserSessions: AdminRevokeUserSessionsUseCase,
    @Inject(RequestContextStorage)
    private readonly requestContext: RequestContextStorage,
    @Inject(EnvironmentService)
    private readonly environment: Pick<
      EnvironmentService,
      "platformHostname" | "trustProxy"
    >,
  ) {}

  @SessionRequired()
  @RequiresPermission("platform.security.session.revoke")
  @Post("users/:userId/sessions/revoke")
  @HttpCode(200)
  @ApiOperation({ operationId: "revokePlatformUserSessions" })
  @ApiParam({ name: "userId", type: String, format: "uuid" })
  @ApiBody({ type: PlatformSessionRevocationRequestDto })
  @ApiOkResponse({ type: PlatformSessionRevocationResponseDto })
  async revoke(
    @Param("userId") userId: string,
    @Body() body: PlatformSessionRevocationRequestDto,
    @Req() request: PlatformSecurityRequest,
    @CurrentAuthorizationContext() authorization: AuthorizationContext,
  ): Promise<PlatformSessionRevocationResponseDto> {
    const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
    if (!hostname || hostname !== this.environment.platformHostname.toLowerCase()) {
      throw new NotFoundException();
    }
    const authenticated = this.requestContext.requireAuthenticated();

    try {
      return await this.revokeUserSessions.execute({
        authorization,
        targetUserId: requireUuid(userId, "userId"),
        reason: requireReason(body?.reason),
        requestId: authenticated.requestId,
      });
    } catch (error: unknown) {
      if (error instanceof AdminSessionRevocationForbiddenError) {
        throw new ForbiddenException("Platform authorization is required.");
      }
      throw error;
    }
  }
}
