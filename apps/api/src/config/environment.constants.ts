export const ENVIRONMENT_TOKEN = Symbol("ENVIRONMENT_TOKEN");

export const NODE_ENVIRONMENTS = ["development", "test", "production"] as const;

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
