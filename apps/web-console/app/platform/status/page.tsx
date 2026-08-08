import { Alert } from "@booking-os/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@booking-os/ui/card";

import { TenantProvisioningStatus } from "../../../components/tenant-provisioning-status";

interface PlatformStatusPageProps {
  readonly searchParams: Promise<{ readonly tenantId?: string | string[] }>;
}

export default async function PlatformStatusPage({ searchParams }: PlatformStatusPageProps) {
  const parameters = await searchParams;
  const tenantId = typeof parameters.tenantId === "string" ? parameters.tenantId : null;

  return (
    <main className="min-h-screen bg-muted/40 px-4 py-12">
      <div className="mx-auto grid w-full max-w-2xl gap-6">
        <header className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Booking OS
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Tenant provisioning status</h1>
          <p className="text-muted-foreground">
            Inspect the current bootstrap state and owner invitation reference.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Provisioning</CardTitle>
            <CardDescription>
              Status is always loaded without browser or server caching.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tenantId ? (
              <TenantProvisioningStatus tenantId={tenantId} />
            ) : (
              <Alert variant="destructive">
                INVALID_TENANT_REQUEST: A tenantId query parameter is required.
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
