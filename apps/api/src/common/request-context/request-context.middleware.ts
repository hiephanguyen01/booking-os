import { randomUUID } from "node:crypto";

import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";

import { RequestContextStorage } from "./request-context.storage.js";
import type { RequestWithHeaders, ResponseWithHeaders } from "./request-context.types.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const TRACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validOrGenerated(value: string | undefined, pattern: RegExp): string {
  return value !== undefined && pattern.test(value) ? value : randomUUID();
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(RequestContextStorage)
    private readonly storage: RequestContextStorage,
  ) {}

  use(request: RequestWithHeaders, response: ResponseWithHeaders, next: () => void): void {
    const requestId = validOrGenerated(
      request.requestId ?? firstHeaderValue(request.headers["x-request-id"]),
      REQUEST_ID_PATTERN,
    );
    const traceId = validOrGenerated(
      firstHeaderValue(request.headers["x-trace-id"]),
      TRACE_ID_PATTERN,
    );

    response.setHeader("x-request-id", requestId);
    response.setHeader("x-trace-id", traceId);

    this.storage.run({ requestId, traceId, source: "internal" }, next);
  }
}
