import { createApiClient } from "@booking-os/api-client";
import { getMessage } from "@booking-os/i18n";
import { StatusCard } from "@booking-os/ui";

import { resolveAppConfig } from "../src/app-config";
import {
  resolveApiServiceStatus,
  type ApiServiceStatus,
} from "../src/service-status";

export const dynamic = "force-dynamic";

async function loadApiStatus(apiBaseUrl: string): Promise<ApiServiceStatus> {
  try {
    const client = createApiClient({ baseUrl: apiBaseUrl });
    return await resolveApiServiceStatus(client.health.get);
  } catch {
    return {
      state: "degraded",
      reason: "API unavailable",
    };
  }
}

export default async function StorefrontPage() {
  const config = resolveAppConfig();
  const apiStatus = await loadApiStatus(config.apiBaseUrl);
  const statusDescription =
    apiStatus.state === "healthy"
      ? `${getMessage(config.locale, "api.status.healthy")} API ${apiStatus.version}`
      : getMessage(config.locale, "api.status.degraded");

  return (
    <main className="page-shell">
      <section className="hero" aria-labelledby="storefront-title">
        <p className="product-label">Booking OS</p>
        <h1 id="storefront-title">
          {getMessage(config.locale, "storefront.title")}
        </h1>
        <p className="hero-description">
          {getMessage(config.locale, "storefront.description")}
        </p>
      </section>

      <StatusCard
        eyebrow="Storefront"
        title={getMessage(config.locale, "api.status.title")}
        state={apiStatus.state}
        description={statusDescription}
      />
    </main>
  );
}
