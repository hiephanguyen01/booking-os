import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { createStructuredLogger, type StructuredLogger } from "@booking-os/observability";
import { Global, type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { ApiExceptionFilter } from "./api-exception.filter.js";
import { StructuredAuthMetricsAdapter } from "./auth-metrics.adapter.js";
import type { AuthMetricsPort } from "./auth-metrics.port.js";
import { HttpLoggingInterceptor } from "./http-logging.interceptor.js";
import { RequestIdMiddleware } from "./request-id.middleware.js";
import {
  API_LOGGER_TOKEN,
  AUTH_METRICS_PORT,
  MONOTONIC_CLOCK_TOKEN,
  REQUEST_ID_GENERATOR_TOKEN,
  WALL_CLOCK_TOKEN,
} from "./tokens.js";

@Global()
@Module({
  providers: [
    {
      provide: API_LOGGER_TOKEN,
      useFactory: () => createStructuredLogger({ service: "api" }),
    },
    {
      provide: AUTH_METRICS_PORT,
      inject: [API_LOGGER_TOKEN],
      useFactory: (logger: StructuredLogger): AuthMetricsPort =>
        new StructuredAuthMetricsAdapter(logger),
    },
    {
      provide: REQUEST_ID_GENERATOR_TOKEN,
      useValue: randomUUID,
    },
    {
      provide: MONOTONIC_CLOCK_TOKEN,
      useValue: () => performance.now(),
    },
    {
      provide: WALL_CLOCK_TOKEN,
      useValue: () => new Date(),
    },
    RequestIdMiddleware,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
  exports: [API_LOGGER_TOKEN, AUTH_METRICS_PORT, MONOTONIC_CLOCK_TOKEN, WALL_CLOCK_TOKEN],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("{*splat}");
  }
}
