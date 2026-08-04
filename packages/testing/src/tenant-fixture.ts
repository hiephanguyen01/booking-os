export const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
export const TENANT_B_ID = "22222222-2222-4222-8222-222222222222";

export interface TenantFixture {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface TenantFixtureOverrides {
  readonly id?: string;
  readonly slug?: string;
  readonly name?: string;
}

export function createTenantFixture(overrides: TenantFixtureOverrides = {}): TenantFixture {
  return {
    id: overrides.id ?? TENANT_A_ID,
    slug: overrides.slug ?? "tenant-a",
    name: overrides.name ?? "Tenant A",
  };
}
