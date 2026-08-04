import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";
import { TenantContextService } from "./tenant-context.service.js";

interface HostRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

type Next = (error?: unknown) => void;

const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function tenantSlugFromHost(hostValue: string | undefined): string | undefined {
  if (!hostValue) {
    return undefined;
  }

  const [hostname = ""] = hostValue.toLowerCase().split(":", 1);
  const [candidate] = hostname.split(".");

  return candidate && TENANT_SLUG_PATTERN.test(candidate) ? candidate : undefined;
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService) private readonly tenantContext: TenantContextService,
  ) {}

  async use(request: HostRequest, _response: unknown, next: Next): Promise<void> {
    try {
      const slug = tenantSlugFromHost(firstHeaderValue(request.headers.host));

      if (!slug) {
        next();
        return;
      }

      const tenant = await this.prisma.tenant.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!tenant) {
        next();
        return;
      }

      this.tenantContext.runWithResolvedTenant(tenant.id, next);
    } catch (error: unknown) {
      next(error);
    }
  }
}
