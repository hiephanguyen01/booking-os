import type { ResolvedTenant } from "../../domain/resolved-tenant.js";
import { tenantSlugFromHostname } from "../../domain/tenant-slug.js";
import type { TenantDirectoryPort } from "../ports/tenant-directory.port.js";

export class ResolveTenantUseCase {
  private readonly tenants: TenantDirectoryPort;
  private readonly tenantBaseDomain: string;

  constructor(tenants: TenantDirectoryPort, tenantBaseDomain: string) {
    this.tenants = tenants;
    this.tenantBaseDomain = tenantBaseDomain;
  }

  async execute(hostname: string): Promise<ResolvedTenant | null> {
    const slug = tenantSlugFromHostname(hostname, this.tenantBaseDomain);
    if (!slug) {
      return null;
    }

    return this.tenants.findActiveBySlug(slug);
  }
}
