import { Global, type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { RequestContextMiddleware } from "./request-context.middleware.js";
import { RequestContextStorage } from "./request-context.storage.js";

@Global()
@Module({
  providers: [RequestContextStorage, RequestContextMiddleware],
  exports: [RequestContextStorage],
})
export class RequestContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
