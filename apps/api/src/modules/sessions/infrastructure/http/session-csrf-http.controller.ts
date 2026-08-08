import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";

import { SupportedApi } from "../../../../api-visibility/api-visibility.decorator.js";
import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { EnvironmentService } from "../../../../config/environment.service.js";
import { CsrfController, type CsrfResponse } from "./csrf.controller.js";
import { deriveSessionCsrfKey } from "./csrf-key.js";

type SessionCsrfRequest = Parameters<CsrfController["getCsrf"]>[0];
type SessionCsrfHeaderResponse = Parameters<CsrfController["getCsrf"]>[1];

class SessionCsrfResponseDto {
  @ApiProperty({ type: String })
  readonly csrfToken!: string;
}

@SupportedApi()
@ApiTags("sessions")
@Controller("auth/session")
export class SessionCsrfHttpController extends CsrfController {
  constructor(
    @Inject(RequestContextStorage) requestContext: RequestContextStorage,
    @Inject(EnvironmentService) environment: EnvironmentService,
  ) {
    super(requestContext, {
      csrfKey: deriveSessionCsrfKey(environment.sessionSecret),
      trustProxy: environment.trustProxy,
    });
  }

  @Get("csrf")
  @ApiOperation({ operationId: "getSessionCsrf" })
  @ApiOkResponse({ type: SessionCsrfResponseDto })
  override getCsrf(
    @Req() request: SessionCsrfRequest,
    @Res({ passthrough: true }) response: SessionCsrfHeaderResponse,
  ): CsrfResponse {
    return super.getCsrf(request, response);
  }
}

@SupportedApi()
@ApiTags("sessions")
@Controller("auth")
export class CanonicalSessionCsrfHttpController extends SessionCsrfHttpController {
  constructor(
    @Inject(RequestContextStorage) requestContext: RequestContextStorage,
    @Inject(EnvironmentService) environment: EnvironmentService,
  ) {
    super(requestContext, environment);
  }

  @Get("csrf")
  @ApiOperation({ operationId: "getCsrf" })
  @ApiOkResponse({ type: SessionCsrfResponseDto })
  override getCsrf(
    @Req() request: SessionCsrfRequest,
    @Res({ passthrough: true }) response: SessionCsrfHeaderResponse,
  ): CsrfResponse {
    return super.getCsrf(request, response);
  }
}
