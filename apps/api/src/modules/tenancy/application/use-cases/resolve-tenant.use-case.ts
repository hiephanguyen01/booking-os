import type { ResolvedTenant } from "../../domain/resolved-tenant.js";
import { tenantSlugFromHostname } from "../../domain/tenant-slug.js";
import type { TenantDirectoryPort } from "../ports/tenant-directory.port.js";

export class ResolveTenantUseCase {
  private readonly tenants: TenantDirectoryPort;

  constructor(tenants: TenantDirectoryPort) {
    this.tenants = tenants;
  }

  async execute(hostname: string): Promise<ResolvedTenant | null> {
    const slug = tenantSlugFromHostname(hostname);
    if (!slug) {
      return null;
    }

    return this.tenants.findActiveBySlug(slug);
  }
}
