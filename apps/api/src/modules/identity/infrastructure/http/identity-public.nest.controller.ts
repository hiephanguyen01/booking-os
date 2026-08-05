import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";

import { SupportedApi } from "../../../../api-visibility/api-visibility.decorator.js";
import type { IdentityScopeType } from "../../domain/user.js";
import {
  type CompleteIdentityPasswordBody,
  IdentityPublicController,
  type IdentityPublicHttpRequest,
  type IdentityPublicHttpResponse,
  type RequestIdentityPasswordResetBody,
} from "./identity-public.controller.js";
import type { PreAuthCsrfPurpose } from "./pre-auth-csrf.js";

const PRE_AUTH_CSRF_COOKIE_NAME = "__Host-booking_pre_auth_csrf";
const SECURITY_HEADER_ERROR = "Ambiguous identity security header.";
const PURPOSES = ["activation", "password_forgot", "password_reset"] as const;
const SCOPES = ["platform", "tenant"] as const;

type HeaderValue = string | readonly string[] | undefined;

interface NestIdentityRequest {
  readonly hostname: string;
  readonly protocol: string;
  readonly headers: Readonly<Record<string, HeaderValue>>;
  readonly requestId?: string | null;
}

class PreAuthCsrfResponseDto {
  @ApiProperty({ type: String })
  csrfToken!: string;

  @ApiProperty({ type: String, format: "date-time" })
  expiresAt!: string;
}

class AcceptedResponseDto {
  @ApiProperty({ type: Boolean, example: true })
  accepted!: true;
}

class CompletedResponseDto {
  @ApiProperty({ type: Boolean, example: true })
  completed!: true;
}

class IdentityScopeDto {
  @ApiProperty({ type: String, enum: SCOPES })
  scopeType!: IdentityScopeType;

  @ApiProperty({ type: String, required: false, format: "uuid" })
  tenantId?: string;
}

class CompleteIdentityPasswordDto extends IdentityScopeDto {
  @ApiProperty({ type: String })
  token!: string;

  @ApiProperty({ type: String, minLength: 12 })
  newPassword!: string;
}

class RequestIdentityPasswordResetDto extends IdentityScopeDto {
  @ApiProperty({ type: String, format: "email" })
  email!: string;
}

function singleHeader(value: HeaderValue): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(SECURITY_HEADER_ERROR);
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function normalizeHostname(value: string): string {
  const hostname = value.trim().normalize("NFC").toLowerCase();
  if (hostname.length === 0) {
    throw new TypeError("Identity request hostname cannot be empty.");
  }
  return hostname;
}

function normalizeProtocol(value: string): "http" | "https" {
  const protocol = value.trim().toLowerCase();
  if (protocol !== "http" && protocol !== "https") {
    throw new TypeError("Identity request protocol is invalid.");
  }
  return protocol;
}

function trustedRequestOrigin(request: NestIdentityRequest, hostname: string): string {
  const host = singleHeader(request.headers.host);
  if (!host) {
    throw new TypeError("Identity request host is required.");
  }

  let origin: URL;
  try {
    origin = new URL(`${normalizeProtocol(request.protocol)}://${host}`);
  } catch {
    throw new TypeError("Identity request host is invalid.");
  }

  if (origin.hostname.toLowerCase() !== hostname) {
    throw new TypeError("Identity request host is invalid.");
  }

  return origin.origin;
}

function preAuthCookie(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const matches: string[] = [];
  for (const segment of value.split(";")) {
    const pair = segment.trim();
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    if (pair.slice(0, separator).trim() === PRE_AUTH_CSRF_COOKIE_NAME) {
      matches.push(pair.slice(separator + 1).trim());
    }
  }

  if (matches.length > 1) {
    throw new TypeError(SECURITY_HEADER_ERROR);
  }
  return matches[0] && matches[0].length > 0 ? matches[0] : null;
}

export function toIdentityPublicHttpRequest(
  request: NestIdentityRequest,
): IdentityPublicHttpRequest {
  const hostname = normalizeHostname(request.hostname);
  return Object.freeze({
    hostname,
    expectedOrigin: trustedRequestOrigin(request, hostname),
    origin: singleHeader(request.headers.origin),
    csrfCookie: preAuthCookie(singleHeader(request.headers.cookie)),
    csrfToken: singleHeader(request.headers["x-csrf-token"]),
    requestId: request.requestId ?? null,
  });
}

function requestContext(request: NestIdentityRequest): IdentityPublicHttpRequest {
  try {
    return toIdentityPublicHttpRequest(request);
  } catch (error: unknown) {
    throw new BadRequestException(error instanceof Error ? error.message : SECURITY_HEADER_ERROR);
  }
}

@ApiTags("identity")
@SupportedApi()
@Controller("auth")
export class NestIdentityPublicController {
  constructor(
    @Inject(IdentityPublicController)
    private readonly core: IdentityPublicController,
  ) {}

  @Get("csrf")
  @ApiOperation({ operationId: "getPreAuthCsrf" })
  @ApiQuery({ name: "purpose", enum: PURPOSES })
  @ApiOkResponse({ type: PreAuthCsrfResponseDto })
  @ApiBadRequestResponse()
  getCsrf(
    @Query("purpose") purpose: PreAuthCsrfPurpose,
    @Req() request: NestIdentityRequest,
    @Res({ passthrough: true }) response: IdentityPublicHttpResponse,
  ): { readonly csrfToken: string; readonly expiresAt: string } {
    if (!PURPOSES.includes(purpose)) {
      throw new BadRequestException("Unsupported pre-auth CSRF purpose.");
    }
    return this.core.getCsrf(purpose, requestContext(request), response);
  }

  @Post("activation/complete")
  @HttpCode(200)
  @ApiOperation({ operationId: "completeAccountActivation" })
  @ApiBody({ type: CompleteIdentityPasswordDto })
  @ApiOkResponse({ type: CompletedResponseDto })
  @ApiBadRequestResponse()
  completeActivation(
    @Body() body: CompleteIdentityPasswordBody,
    @Req() request: NestIdentityRequest,
    @Res({ passthrough: true }) response: IdentityPublicHttpResponse,
  ): Promise<{ readonly completed: true }> {
    return this.core.completeActivation(body, requestContext(request), response);
  }

  @Post("password/forgot")
  @HttpCode(202)
  @ApiOperation({ operationId: "requestPasswordReset" })
  @ApiBody({ type: RequestIdentityPasswordResetDto })
  @ApiAcceptedResponse({ type: AcceptedResponseDto })
  @ApiBadRequestResponse()
  requestPasswordReset(
    @Body() body: RequestIdentityPasswordResetBody,
    @Req() request: NestIdentityRequest,
    @Res({ passthrough: true }) response: IdentityPublicHttpResponse,
  ): Promise<{ readonly accepted: true }> {
    return this.core.requestPasswordReset(body, requestContext(request), response);
  }

  @Post("password/reset")
  @HttpCode(200)
  @ApiOperation({ operationId: "completePasswordReset" })
  @ApiBody({ type: CompleteIdentityPasswordDto })
  @ApiOkResponse({ type: CompletedResponseDto })
  @ApiBadRequestResponse()
  completePasswordReset(
    @Body() body: CompleteIdentityPasswordBody,
    @Req() request: NestIdentityRequest,
    @Res({ passthrough: true }) response: IdentityPublicHttpResponse,
  ): Promise<{ readonly completed: true }> {
    return this.core.completePasswordReset(body, requestContext(request), response);
  }
}
