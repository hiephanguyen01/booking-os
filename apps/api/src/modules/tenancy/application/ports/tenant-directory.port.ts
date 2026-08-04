import type { ResolvedTenant } from "../../domain/resolved-tenant.js";

export interface TenantDirectoryPort {
  findActiveBySlug(slug: string): Promise<ResolvedTenant | null>;
}
