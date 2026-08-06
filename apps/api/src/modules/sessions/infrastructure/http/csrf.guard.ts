import { createHmac } from "node:crypto";

import { readSessionToken, verifyCsrfToken } from "@booking-os/auth";
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import type { RequestHeaders } from "../../../../common/request-context/request-context.types.js";
import { evaluateOrigin } from "./origin-policy.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PRE_AUTH_SESSION_ID = "pre-auth";
const PRE_AUTH_WINDOW_MS = 10 * 60 * 1000;
const SESSION_KEY_LABEL = "booking-os/csrf/session-key/v1";
const PRE_AUTH_KEY_LABEL = "booking-os/csrf/pre-auth-key/v1";

interface CsrfRequest {
  readonly method?: string;
  readonly headers: RequestHeaders;
}

export interface CsrfGuardOptions {
  readonly allowedOrigins: readonly string[];
  readonly csrfKey: Uint8Array;
  readonly trustProxy: boolean;
  readonly now?: () => Date;
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

function reject(): never {
  throw new ForbiddenException("CSRF validation failed.");
}

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly now: () => Date;

  constructor(
    @Inject(RequestContextStorage)
    private readonly requestContext: RequestContextStorage,
    private readonly options: CsrfGuardOptions,
  ) {
    if (options.csrfKey.byteLength < 32) {
      throw new RangeError("CSRF keys must contain at least 32 bytes.");
    }
    this.now = options.now ?? (() => new Date());
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CsrfRequest>();
    const method = request.method?.toUpperCase() ?? "GET";
    if (SAFE_METHODS.has(method)) {
      return true;
    }

    const origin = firstHeaderValue(request.headers.origin);
    const decision = evaluateOrigin({ origin, allowedOrigins: this.options.allowedOrigins });
    const hostname = effectiveHostname(request.headers, this.options.trustProxy);
    if (!decision.allowed || !origin || !hostname || new URL(origin).hostname !== hostname) {
      return reject();
    }

    const presentedToken = firstHeaderValue(request.headers["x-csrf-token"]);
    if (!presentedToken) {
      return reject();
    }

    const authenticated = this.requestContext.getAuthenticated();
    if (authenticated) {
      const cookieHeader = firstHeaderValue(request.headers.cookie) ?? null;
      const sessionToken = readSessionToken(cookieHeader);
      if (!sessionToken) {
        return reject();
      }

      const valid = verifyCsrfToken({
        csrfKey: deriveKey(this.options.csrfKey, SESSION_KEY_LABEL, sessionToken),
        sessionId: authenticated.sessionId,
        hostname,
        token: presentedToken,
      });
      return valid || reject();
    }

    const currentBucket = Math.floor(this.now().getTime() / PRE_AUTH_WINDOW_MS);
    for (const bucket of [currentBucket, currentBucket - 1]) {
      const valid = verifyCsrfToken({
        csrfKey: deriveKey(this.options.csrfKey, PRE_AUTH_KEY_LABEL, String(bucket)),
        sessionId: PRE_AUTH_SESSION_ID,
        hostname,
        token: presentedToken,
      });
      if (valid) {
        return true;
      }
    }

    return reject();
  }
}
