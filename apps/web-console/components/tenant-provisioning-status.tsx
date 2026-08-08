"use client";

import { Alert } from "@booking-os/ui/alert";
import { Button } from "@booking-os/ui/button";
import { useCallback, useEffect, useState } from "react";

import { readProblemMessage } from "./problem-message";

interface TenantProvisioningStatusProps {
  readonly tenantId: string;
}

interface ProvisioningStatus {
  readonly tenantId: string;
  readonly slug: string;
  readonly status: "provisioning";
  readonly ownerMembershipId: string;
  readonly ownerInvitationId: string;
  readonly replayed?: boolean;
}

export function TenantProvisioningStatus({ tenantId }: TenantProvisioningStatusProps) {
  const [status, setStatus] = useState<ProvisioningStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/platform/tenants/${encodeURIComponent(tenantId)}/status`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setError(await readProblemMessage(response));
        return;
      }
      setStatus((await response.json()) as ProvisioningStatus);
    } catch {
      setError("NETWORK_ERROR: Booking OS could not load tenant provisioning status.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {status ? (
        <dl className="grid gap-3 rounded-md border bg-muted/30 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-muted-foreground">Tenant</dt>
            <dd className="font-semibold">{status.slug}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Status</dt>
            <dd className="font-semibold capitalize">{status.status}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Tenant ID</dt>
            <dd className="break-all font-mono text-xs">{status.tenantId}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Owner invitation</dt>
            <dd className="break-all font-mono text-xs">{status.ownerInvitationId}</dd>
          </div>
        </dl>
      ) : null}
      <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
        {loading ? "Refreshing…" : "Refresh status"}
      </Button>
    </div>
  );
}
