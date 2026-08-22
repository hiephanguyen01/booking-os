import type { PermissionKey } from "@booking-os/auth";
import type { Prisma } from "@prisma/client";

import type {
  TenantRbacPermissionRecord,
  TenantRbacPermissionRepositoryPort,
} from "../../../application/ports/tenant-rbac-permission-repository.port.js";

interface PermissionRow {
  readonly id: string;
  readonly key: PermissionKey;
}

export class PrismaTenantRbacPermissionRepositoryAdapter
  implements TenantRbacPermissionRepositoryPort
{
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async findTenantPermissionsByKeys(
    keys: readonly PermissionKey[],
  ): Promise<readonly TenantRbacPermissionRecord[]> {
    if (keys.length === 0) return Object.freeze([]);

    const placeholders = keys.map((_, index) => `$${index + 1}`).join(", ");
    const rows = await this.transaction.$queryRawUnsafe<readonly PermissionRow[]>(
      `SELECT "id", "key"::text AS "key"
       FROM "permissions"
       WHERE "scope_level" = 'tenant'::role_scope_level AND "key" IN (${placeholders})
       ORDER BY "key"`,
      ...keys,
    );
    return Object.freeze(
      [...rows]
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((row) => Object.freeze({ ...row })),
    );
  }
}
