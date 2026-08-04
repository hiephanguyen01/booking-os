import type { HealthDependencyStatus } from "@booking-os/contracts";

export type ReadinessDependency = "postgresql" | "redis";
export type ReadinessFailureReason =
  | "timeout"
  | "connection_failed"
  | "unexpected_response";

export interface ReadinessProbe {
  readonly dependency: ReadinessDependency;
  check(): Promise<HealthDependencyStatus>;
}

export function measureLatency(start: number, end: number): number {
  return Math.round(Math.max(0, end - start) * 1000) / 1000;
}
