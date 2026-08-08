import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@booking-os/ui/card";

import { TenantCreateForm } from "../../../components/tenant-create-form";

export default function PlatformTenantCreatePage() {
  return (
    <main className="min-h-screen bg-muted/40 px-4 py-12">
      <div className="mx-auto grid w-full max-w-2xl gap-6">
        <header className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Booking OS</p>
          <h1 className="text-3xl font-semibold tracking-tight">Create tenant</h1>
          <p className="text-muted-foreground">
            Bootstrap a tenant and queue the initial owner invitation from the platform console.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Tenant bootstrap</CardTitle>
            <CardDescription>
              Provisioning is idempotent and starts in the provisioning state.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TenantCreateForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
