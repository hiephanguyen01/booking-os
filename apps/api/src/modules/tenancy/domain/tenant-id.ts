const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isTenantId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function assertTenantId(value: string): void {
  if (!isTenantId(value)) {
    throw new TypeError("Tenant ID must be a valid UUID.");
  }
}
