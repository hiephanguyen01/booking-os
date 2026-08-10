import { readSessionToken, serializeSessionCookie } from "@booking-os/auth";
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { SupportedApi } from "../../../../api-visibility/api-visibility.decorator.js";
import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import type {
  AuthorizationReadyRequestContext,
  RequestHeaders,
} from "../../../../common/request-context/request-context.types.js";
import { isAuthorizationReadyRequestContext } from "../../../../common/request-context/request-context.types.js";
import { SessionRequired } from "../../../../common/security/session-required.decorator.js";
import type {
  GetCurrentAuthorizationInput,
  GetCurrentAuthorizationResult,
} from "../../application/use-cases/get-current-authorization.use-case.js";
import { GetCurrentAuthorizationUseCase } from "../../application/use-cases/get-current-authorization.use-case.js";
import { AuthorizationContextResponseDto } from "./authorization.dto.js";

interface CurrentAuthorizationExecutor {
  execute(input: GetCurrentAuthorizationInput): Promise<GetCurrentAuthorizationResult>;
}

interface AuthorizationRequest {
  readonly headers: RequestHeaders;
}

interface AuthorizationResponse {
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

interface AuthenticatedContextReader {
  requireAuthenticated(): ReturnType<RequestContextStorage["requireAuthenticated"]>;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requireAuthorizationReady(
  authenticated: ReturnType<RequestContextStorage["requireAuthenticated"]>,
): AuthorizationReadyRequestContext {
  if (!isAuthorizationReadyRequestContext(authenticated)) {
    throw new ForbiddenException("An active authorization snapshot is required.");
  }
  return authenticated;
}

@SupportedApi()
@ApiTags("authorization")
@Controller("auth/me")
export class AuthorizationController {
  constructor(
    @Inject(GetCurrentAuthorizationUseCase)
    private readonly currentAuthorization: CurrentAuthorizationExecutor,
    @Inject(RequestContextStorage)
    private readonly requestContext: AuthenticatedContextReader,
  ) {}

  @SessionRequired()
  @Get("authorization")
  @ApiOperation({ operationId: "getCurrentAuthorization" })
  @ApiOkResponse({ type: AuthorizationContextResponseDto })
  async current(
    @Req() request: AuthorizationRequest,
    @Res() response: AuthorizationResponse,
  ): Promise<void> {
    const authenticated = requireAuthorizationReady(this.requestContext.requireAuthenticated());
    const presentedToken = readSessionToken(firstHeaderValue(request.headers.cookie) ?? null);
    if (!presentedToken) {
      throw new UnauthorizedException("Authentication is required.");
    }

    const result = await this.currentAuthorization.execute({ authenticated, presentedToken });
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Vary", "Cookie, Origin");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (result.status === "refreshed") {
      response.setHeader("Set-Cookie", serializeSessionCookie(result.successorToken));
    }
    response.end(JSON.stringify(result.context));
  }
}
