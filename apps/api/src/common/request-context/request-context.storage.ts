import { AsyncLocalStorage } from "node:async_hooks";

import type { RequestContext } from "@booking-os/contracts";
import { Injectable } from "@nestjs/common";

import {
  type AuthenticatedRequestContext,
  isAuthenticatedRequestContext,
} from "./request-context.types.js";

@Injectable()
export class RequestContextStorage {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, work: () => T): T {
    return this.storage.run(Object.freeze({ ...context }), work);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  require(): RequestContext {
    const context = this.get();

    if (!context) {
      throw new Error("Request context is unavailable.");
    }

    return context;
  }

  getAuthenticated(): AuthenticatedRequestContext | undefined {
    const context = this.get();
    return context && isAuthenticatedRequestContext(context) ? context : undefined;
  }

  requireAuthenticated(): AuthenticatedRequestContext {
    const context = this.getAuthenticated();
    if (!context) {
      throw new Error("Authenticated request context is unavailable.");
    }
    return context;
  }
}
