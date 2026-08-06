import { serializeExpiredSessionCookie, serializeSessionCookie } from "@booking-os/auth";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiParam } from "@nestjs/swagger";

import type { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import type { RequestHeaders } from "../../../../common/request-context/request-context.types.js";
import type {
  SessionScope,
  StoredSession,
} from "../../application/ports/session-repository.port.js";
import type {
  ListSessionsInput,
  SessionSummary,
} from "../../application/use-cases/list-sessions.js";
import { InvalidLoginError, type LoginInput } from "../../application/use-cases/login.use-case.js";
import type { RevokeOtherSessionsInput } from "../../application/use-cases/revoke-other-sessions.js";
import type { RevokeSessionInput } from "../../application/use-cases/revoke-session.js";
import { SessionRequired } from "./session-required.decorator.js";

interface LoginExecutor {
  execute(input: LoginInput): Promise<{ readonly token: string; readonly session: StoredSession }>;
}

interface RevokeSessionExecutor {
  execute(input: RevokeSessionInput): Promise<{ readonly revoked: boolean }>;
}

interface ListSessionsExecutor {
  execute(input: ListSessionsInput): Promise<readonly SessionSummary[]>;
}

interface RevokeOtherSessionsExecutor {
  execute(input: RevokeOtherSessionsInput): Promise<{ readonly revokedCount: number }>;
}

export interface LoginRequestBody {
  readonly email: string;
  readonly password: string;
  readonly [key: string]: unknown;
}

interface AuthRequest {
  readonly ip?: string;
  readonly headers: RequestHeaders;
}

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

export interface AuthControllerOptions {
  readonly trustProxy: boolean;
}

export interface LoginResponse {
  readonly session: {
    readonly id: string;
    readonly state: StoredSession["state"];
    readonly scope: SessionScope;
  };
}

export interface LogoutResponse {
  readonly loggedOut: true;
}

export interface CurrentAuthenticationResponse {
  readonly actor: {
    readonly id: string;
  };
  readonly session: {
    readonly id: string;
    readonly state: "active" | "invitation_pending";
    readonly scope: SessionScope;
  };
}

export interface SessionListResponse {
  readonly sessions: readonly SessionSummary[];
}

export interface RevokeDeviceResponse {
  readonly revoked: boolean;
}

export interface RevokeOtherSessionsResponse {
  readonly revokedCount: number;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function effectiveHostname(headers: RequestHeaders, trustProxy: boolean): string | undefined {
  const forwarded = firstHeaderValue(headers["x-forwarded-host"]);
  const direct = firstHeaderValue(headers.host);
  const selected = trustProxy && forwarded ? forwarded.split(",", 1)[0] : direct;
  const normalized = selected?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const bracketed = /^\[([^\]]+)](?::\d+)?$/.exec(normalized);
  return bracketed?.[1] ?? normalized.replace(/:\d+$/, "");
}

function trustedScope(context: { readonly tenantId?: string }): SessionScope {
  return context.tenantId ? { type: "tenant", tenantId: context.tenantId } : { type: "platform" };
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginExecutor,
    private readonly requestContext: RequestContextStorage,
    private readonly options: AuthControllerOptions,
    private readonly revokeSessionUseCase?: RevokeSessionExecutor,
    private readonly listSessionsUseCase?: ListSessionsExecutor,
    private readonly revokeOtherSessionsUseCase?: RevokeOtherSessionsExecutor,
  ) {}

  @Post("login")
  async login(
    @Body() body: LoginRequestBody,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<LoginResponse> {
    response.setHeader("Cache-Control", "private, no-store");

    const context = this.requestContext.require();
    const hostname = effectiveHostname(request.headers, this.options.trustProxy);
    const ipAddress = request.ip?.trim();
    if (!hostname || !ipAddress || !body.email || !body.password) {
      throw new BadRequestException("Invalid authentication request.");
    }

    try {
      const issued = await this.loginUseCase.execute({
        email: body.email,
        password: body.password,
        ipAddress,
        hostname,
        scope: trustedScope(context),
        requestId: context.requestId,
      });
      response.setHeader("Set-Cookie", serializeSessionCookie(issued.token));
      return {
        session: {
          id: issued.session.id,
          state: issued.session.state,
          scope: issued.session.scope,
        },
      };
    } catch (error) {
      if (error instanceof InvalidLoginError) {
        throw new UnauthorizedException("Invalid email or password.");
      }
      throw error;
    }
  }

  @SessionRequired()
  @Post("logout")
  async logout(@Res({ passthrough: true }) response: HeaderResponse): Promise<LogoutResponse> {
    response.setHeader("Cache-Control", "private, no-store");

    const authenticated = this.requestContext.requireAuthenticated();
    if (!this.revokeSessionUseCase) {
      throw new ServiceUnavailableException("Logout is unavailable.");
    }

    await this.revokeSessionUseCase.execute({
      sessionId: authenticated.sessionId,
      userId: authenticated.actorId,
      reason: "logout",
      requestId: authenticated.requestId,
    });
    response.setHeader("Set-Cookie", serializeExpiredSessionCookie());
    return { loggedOut: true };
  }

  @SessionRequired()
  @Get("me")
  me(@Res({ passthrough: true }) response: HeaderResponse): CurrentAuthenticationResponse {
    response.setHeader("Cache-Control", "private, no-store");

    const authenticated = this.requestContext.requireAuthenticated();
    return {
      actor: { id: authenticated.actorId },
      session: {
        id: authenticated.sessionId,
        state: authenticated.sessionState,
        scope: authenticated.authScope,
      },
    };
  }

  @SessionRequired()
  @Get("sessions")
  async sessions(
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<SessionListResponse> {
    response.setHeader("Cache-Control", "private, no-store");

    const authenticated = this.requestContext.requireAuthenticated();
    if (!this.listSessionsUseCase) {
      throw new ServiceUnavailableException("Session listing is unavailable.");
    }

    return {
      sessions: await this.listSessionsUseCase.execute({
        userId: authenticated.actorId,
        currentSessionId: authenticated.sessionId,
      }),
    };
  }

  @SessionRequired()
  @Post("sessions/revoke-others")
  async revokeOtherSessions(
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<RevokeOtherSessionsResponse> {
    response.setHeader("Cache-Control", "private, no-store");

    const authenticated = this.requestContext.requireAuthenticated();
    if (!this.revokeOtherSessionsUseCase) {
      throw new ServiceUnavailableException("Session revocation is unavailable.");
    }

    return this.revokeOtherSessionsUseCase.execute({
      userId: authenticated.actorId,
      currentSessionId: authenticated.sessionId,
      requestId: authenticated.requestId,
    });
  }

  @SessionRequired()
  @Delete("sessions/:sessionId")
  @ApiParam({ name: "sessionId", required: true, type: String, format: "uuid" })
  async revokeSession(
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<RevokeDeviceResponse> {
    response.setHeader("Cache-Control", "private, no-store");

    const authenticated = this.requestContext.requireAuthenticated();
    if (!this.revokeSessionUseCase) {
      throw new ServiceUnavailableException("Session revocation is unavailable.");
    }

    const result = await this.revokeSessionUseCase.execute({
      sessionId,
      userId: authenticated.actorId,
      reason: "device_revoked",
      requestId: authenticated.requestId,
    });
    if (sessionId === authenticated.sessionId) {
      response.setHeader("Set-Cookie", serializeExpiredSessionCookie());
    }
    return result;
  }
}
