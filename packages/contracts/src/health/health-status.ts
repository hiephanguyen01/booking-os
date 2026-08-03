export const HEALTH_STATUSES = ["ok", "degraded", "unavailable"] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];
