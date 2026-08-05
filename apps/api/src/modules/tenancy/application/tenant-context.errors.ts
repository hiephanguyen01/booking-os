export class TenantContextUnavailableError extends Error {
  override readonly name = "TenantContextUnavailableError";

  constructor() {
    super("Tenant context is unavailable.");
  }
}

export class InvalidTenantContextError extends Error {
  override readonly name = "InvalidTenantContextError";

  constructor() {
    super("Tenant ID must be a valid UUID.");
  }
}

export class TenantContextConflictError extends Error {
  override readonly name = "TenantContextConflictError";
  readonly activeTenantId: string;
  readonly requestedTenantId: string;

  constructor(activeTenantId: string, requestedTenantId: string) {
    super(
      `Cannot switch tenant context from ${activeTenantId} to ${requestedTenantId} within an active transaction.`,
    );
    this.activeTenantId = activeTenantId;
    this.requestedTenantId = requestedTenantId;
  }
}
