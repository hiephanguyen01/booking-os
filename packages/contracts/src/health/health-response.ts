import type { HealthStatus } from "./health-status.js";

export interface HealthDependencyStatus {
  readonly status: HealthStatus;
  readonly latencyMs?: number;
  readonly message?: string;
}

export interface HealthResponse {
  readonly service: string;
  readonly status: HealthStatus;
  readonly version: string;
  readonly timestamp: string;
  readonly uptimeSeconds: number;
  readonly dependencies?: Readonly<Record<string, HealthDependencyStatus>>;
}
