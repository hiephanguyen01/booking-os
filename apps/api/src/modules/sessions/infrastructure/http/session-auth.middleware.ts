import { readSessionToken } from "@booking-os/auth";
import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import type {
  AuthenticatedRequestContext,
  RequestHeaders,
} from "../../../../common/request-context/request-context.types.js";
import type {
  CurrentSession,
  GetCurrentSessionInput,
} from "../../application/use-cases/get-current-session.use-case.js";
import { GetCurrentSessionUseCase } from "../../application/use-cases/get-current-session.use-case.js";
import { SessionUnavailableError } from "../../domain/session-errors.js";

interface SessionAuthRequest {
  readonly headers: RequestHeaders;
}

interface SessionAuthOptions {
  readonly trustProxy: boolean;
}

type Next = (error?: unknown) => void;

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

interface CurrentSessionResolver {
  execute(input: GetCurrentSessionInput): Promise<CurrentSession>;
}

@Injectable()
export class SessionAuthMiddleware implements NestMiddleware {
  constructor(
    @Inject(GetCurrentSessionUseCase)
    private readonly currentSession: CurrentSessionResolver,
    @Inject(RequestContextStorage)
    private readonly requestContext: RequestContextStorage,
    private readonly options: SessionAuthOptions,
  ) {}

  async use(request: SessionAuthRequest, _response: unknown, next: Next): Promise<void> {
    const cookieHeader = firstHeaderValue(request.headers.cookie) ?? null;
    const token = readSessionToken(cookieHeader);
    if (!token) {
      next();
      return;
    }

    try {
      const current = this.requestContext.require();
      const hostname = effectiveHostname(request.headers, this.options.trustProxy);
      if (!hostname) {
        throw new SessionUnavailableError();
      }
      const scope = current.tenantId
        ? ({ type: "tenant", tenantId: current.tenantId } as const)
        : ({ type: "platform" } as const);
      const authenticated = await this.currentSession.execute({
        token,
        hostname,
        scope,
        requestId: current.requestId,
      });
      const authenticatedContext: AuthenticatedRequestContext = {
        ...current,
        actorId: authenticated.actorId,
        sessionId: authenticated.sessionId,
        authScope: authenticated.authScope,
        sessionState: authenticated.sessionState,
        authorizationVersion: authenticated.authorizationVersion,
      };

      this.requestContext.run(authenticatedContext, next);
    } catch (error: unknown) {
      next(error);
    }
  }
}
