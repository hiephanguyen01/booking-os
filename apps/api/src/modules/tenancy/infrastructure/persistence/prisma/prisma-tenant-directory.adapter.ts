import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../../database/prisma.service.js";
import type { TenantDirectoryPort } from "../../../application/ports/tenant-directory.port.js";
import type { ResolvedTenant } from "../../../domain/resolved-tenant.js";

@Injectable()
export class PrismaTenantDirectoryAdapter implements TenantDirectoryPort {
  private readonly prisma: PrismaService;

  constructor(@Inject(PrismaService) prisma: PrismaService) {
    this.prisma = prisma;
  }

  findActiveBySlug(slug: string): Promise<ResolvedTenant | null> {
    return this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true },
    });
  }
}
