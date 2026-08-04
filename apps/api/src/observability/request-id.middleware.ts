import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";

import type { RequestWithContext } from "./request-context.js";
import { selectRequestId } from "./request-id.js";
import {
  REQUEST_ID_GENERATOR_TOKEN,
  type RequestIdGenerator,
} from "./tokens.js";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(
    @Inject(REQUEST_ID_GENERATOR_TOKEN)
    private readonly generateRequestId: RequestIdGenerator,
  ) {}

  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const requestId = selectRequestId(request.headers["x-request-id"], this.generateRequestId);

    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  }
}
