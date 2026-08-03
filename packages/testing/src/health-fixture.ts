import type {
  HealthDependencyStatus,
  HealthResponse,
} from "@booking-os/contracts/health";

export interface HealthResponseFixtureOverrides {
  readonly service?: string;
  readonly status?: HealthResponse["status"];
  readonly version?: string;
  readonly timestamp?: string;
  readonly uptimeSeconds?: number;
  readonly dependencies?: Readonly<Record<string, HealthDependencyStatus>>;
}

function cloneDependencies(
  dependencies: Readonly<Record<string, HealthDependencyStatus>>,
): Record<string, HealthDependencyStatus> {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, dependency]) => [
      name,
      { ...dependency },
    ]),
  );
}

export function createHealthResponseFixture(
  overrides: HealthResponseFixtureOverrides = {},
): HealthResponse {
  return {
    service: overrides.service ?? "api",
    status: overrides.status ?? "ok",
    version: overrides.version ?? "0.1.0",
    timestamp: overrides.timestamp ?? "2026-08-03T12:00:00.000Z",
    uptimeSeconds: overrides.uptimeSeconds ?? 42,
    dependencies: cloneDependencies(overrides.dependencies ?? {}),
  };
}
