export type ApiServiceStatus =
  | { readonly state: "healthy"; readonly version: string }
  | { readonly state: "degraded"; readonly reason: string };

export interface HealthSnapshot {
  readonly status: "ok" | "degraded" | "unavailable";
  readonly version: string;
}

const DEGRADED_STATUS: ApiServiceStatus = {
  state: "degraded",
  reason: "API unavailable",
};

export async function resolveApiServiceStatus(
  getHealth: () => Promise<HealthSnapshot>,
): Promise<ApiServiceStatus> {
  try {
    const health = await getHealth();

    return health.status === "ok"
      ? { state: "healthy", version: health.version }
      : DEGRADED_STATUS;
  } catch {
    return DEGRADED_STATUS;
  }
}
