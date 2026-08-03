export interface HealthCheckJobFixture {
  readonly id: string;
  readonly name: "health-check";
  readonly data: {
    readonly correlationId: string;
  };
}

export interface HealthCheckJobFixtureOverrides {
  readonly id?: string;
  readonly correlationId?: string;
}

export function createHealthCheckJobFixture(
  overrides: HealthCheckJobFixtureOverrides = {},
): HealthCheckJobFixture {
  return {
    id: overrides.id ?? "job-1",
    name: "health-check",
    data: {
      correlationId: overrides.correlationId ?? "corr-1",
    },
  };
}
