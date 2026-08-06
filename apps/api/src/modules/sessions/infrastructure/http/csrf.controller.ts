import { createHmac } from "node:crypto";

import { createCsrfNonce, deriveCsrfToken, readSessionToken } from "@booking-os/auth";
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Req,
  Res,
} from "@nestjs/common";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import type { RequestHeaders } from "../../../../common/request-context/request-context.types.js";

const PRE_AUTH_SESSION_ID = "pre-auth";
const PRE_AUTH_WINDOW_MS = 10 * 60 * 1000;
const SESSION_KEY_LABEL = "booking-os/csrf/session-key/v1";
const PRE_AUTH_KEY_LABEL = "booking-os/csrf/pre-auth-key/v1";

interface CsrfRequest {
  readonly headers: RequestHeaders;
}

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

export interface CsrfResponse {
  readonly csrfToken: string;
}

export interface CsrfControllerOptions {
  readonly csrfKey: Uint8Array;
  readonly trustProxy: boolean;
  readonly now?: () => Date;
  readonly createNonce?: () => string;
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

function deriveKey(rootKey: Uint8Array, label: string, value: string): Uint8Array {
  return createHmac("sha256", rootKey)
    .update(label, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest();
}

@Injectable()
@Controller("auth")
export class CsrfController {
  private readonly now: () => Date;
  private readonly nonce: () => string;

  constructor(
    @Inject(RequestContextStorage)
    private readonly requestContext: RequestContextStorage,
    private readonly options: CsrfControllerOptions,
  ) {
    if (options.csrfKey.byteLength < 32) {
      throw new RangeError("CSRF keys must contain at least 32 bytes.");
    }
    this.now = options.now ?? (() => new Date());
    this.nonce = options.createNonce ?? (() => createCsrfNonce());
  }

  @Get("csrf")
  getCsrf(
    @Req() request: CsrfRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): CsrfResponse {
    response.setHeader("Cache-Control", "private, no-store");

    const hostname = effectiveHostname(request.headers, this.options.trustProxy);
    if (!hostname) {
      throw new ForbiddenException("CSRF issuance failed.");
    }

    const authenticated = this.requestContext.getAuthenticated();
    const nonce = this.nonce();
    if (authenticated) {
      const cookieHeader = firstHeaderValue(request.headers.cookie) ?? null;
      const sessionToken = readSessionToken(cookieHeader);
      if (!sessionToken) {
        throw new ForbiddenException("CSRF issuance failed.");
      }

      return {
        csrfToken: deriveCsrfToken({
          csrfKey: deriveKey(this.options.csrfKey, SESSION_KEY_LABEL, sessionToken),
          sessionId: authenticated.sessionId,
          hostname,
          nonce,
        }),
      };
    }

    const bucket = String(Math.floor(this.now().getTime() / PRE_AUTH_WINDOW_MS));
    return {
      csrfToken: deriveCsrfToken({
        csrfKey: deriveKey(this.options.csrfKey, PRE_AUTH_KEY_LABEL, bucket),
        sessionId: PRE_AUTH_SESSION_ID,
        hostname,
        nonce,
      }),
    };
  }
}
