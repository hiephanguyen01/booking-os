import type { StructuredLogger } from "@booking-os/observability";

export interface ApiReadyContext {
  readonly environment: string;
  readonly address: string;
}

export function logApiReady(
  logger: StructuredLogger,
  context: ApiReadyContext,
): void {
  logger.info("service.ready", context);
}

export function logApiBootstrapFailure(
  logger: StructuredLogger,
  error: unknown,
): void {
  logger.error("service.bootstrap_failed", error);
}
