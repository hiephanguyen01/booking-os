import { TenantCustomRoleNameInvalidError } from "./tenant-rbac.errors.js";

export const TENANT_CUSTOM_ROLE_NAME_MAX_LENGTH = 100;

export interface NormalizedTenantCustomRoleName {
  readonly name: string;
  readonly normalizedName: string;
}

export function normalizeTenantCustomRoleName(value: string): NormalizedTenantCustomRoleName {
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (name.length === 0 || [...name].length > TENANT_CUSTOM_ROLE_NAME_MAX_LENGTH) {
    throw new TenantCustomRoleNameInvalidError();
  }

  return Object.freeze({
    name,
    normalizedName: name.toLowerCase(),
  });
}
