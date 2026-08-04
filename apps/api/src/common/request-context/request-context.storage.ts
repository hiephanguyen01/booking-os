import { AsyncLocalStorage } from "node:async_hooks";

import type { RequestContext } from "@booking-os/contracts";
import { Injectable } from "@nestjs/common";

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
}
