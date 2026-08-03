import { createApiClient } from "@booking-os/api-client";
import {
  PERMISSIONS,
  hasPermission,
} from "@booking-os/auth";
import { getMessage } from "@booking-os/i18n";
import { StatusCard } from "@booking-os/ui";

import { resolveAppConfig } from "../src/app-config.js";
import { samplePartnerSession } from "../src/sample-session.js";
import {
  resolveApiServiceStatus,
  type ApiServiceStatus,
} from "../src/service-status.js";

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

export default async function ConsolePage() {
  const config = resolveAppConfig();
  const apiStatus = await loadApiStatus(config.apiBaseUrl);
  const canManageListings = hasPermission(
    samplePartnerSession,
    PERMISSIONS.listingManage,
  );
  const statusDescription =
    apiStatus.state === "healthy"
      ? `${getMessage(config.locale, "api.status.healthy")} API ${apiStatus.version}`
      : getMessage(config.locale, "api.status.degraded");

  return (
    <main className="console-shell">
      <header className="console-header">
        <p className="product-label">Booking OS</p>
        <h1>{getMessage(config.locale, "console.title")}</h1>
        <p className="header-description">
          {getMessage(config.locale, "console.description")}
        </p>
      </header>

      <section className="console-grid" aria-label="Console overview">
        <StatusCard
          eyebrow="Console"
          title={getMessage(config.locale, "api.status.title")}
          state={apiStatus.state}
          description={statusDescription}
        />

        <article className="session-card" aria-labelledby="session-title">
          <p className="card-eyebrow">
            {getMessage(config.locale, "console.session.title")}
          </p>
          <h2 id="session-title">{samplePartnerSession.user.displayName}</h2>
          <dl>
            <div>
              <dt>Role</dt>
              <dd>{samplePartnerSession.user.role}</dd>
            </div>
            <div>
              <dt>Listing permission</dt>
              <dd>
                {getMessage(
                  config.locale,
                  canManageListings
                    ? "console.permission.allowed"
                    : "console.permission.denied",
                )}
              </dd>
            </div>
          </dl>
        </article>
      </section>
    </main>
  );
}
