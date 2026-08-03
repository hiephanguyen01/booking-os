import {
  normalizeLocale,
  type Locale,
} from "@booking-os/i18n";

const DEFAULT_API_BASE_URL = "http://localhost:3001/api";

export interface StorefrontAppConfig {
  readonly apiBaseUrl: string;
  readonly locale: Locale;
}

export function resolveAppConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): StorefrontAppConfig {
  const configuredApiBaseUrl = environment.API_BASE_URL?.trim();

  return {
    apiBaseUrl: configuredApiBaseUrl || DEFAULT_API_BASE_URL,
    locale: normalizeLocale(environment.APP_LOCALE),
  };
}
