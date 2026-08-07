export interface TenantOwnedTablePolicy {
  readonly table: string;
  readonly tenantColumn: string;
  readonly tenantColumnNullable: boolean;
  readonly applicationRole: string;
}

export const TENANT_POLICY_MANIFEST = Object.freeze([
  Object.freeze({
    table: "tenant_probes",
    tenantColumn: "tenant_id",
    tenantColumnNullable: false,
    applicationRole: "booking_app",
  }),
  Object.freeze({
    table: "outbox_events",
    tenantColumn: "tenant_id",
    tenantColumnNullable: true,
    applicationRole: "booking_app",
  }),
  Object.freeze({
    table: "auth_sessions",
    tenantColumn: "tenant_id",
    tenantColumnNullable: true,
    applicationRole: "booking_app",
  }),
  Object.freeze({
    table: "auth_session_tokens",
    tenantColumn: "tenant_id",
    tenantColumnNullable: true,
    applicationRole: "booking_app",
  }),
  Object.freeze({
    table: "tenant_memberships",
    tenantColumn: "tenant_id",
    tenantColumnNullable: false,
    applicationRole: "booking_app",
  }),
  Object.freeze({
    table: "membership_invitations",
    tenantColumn: "tenant_id",
    tenantColumnNullable: false,
    applicationRole: "booking_app",
  }),
  Object.freeze({
    table: "role_assignments",
    tenantColumn: "tenant_id",
    tenantColumnNullable: true,
    applicationRole: "booking_app",
  }),
  Object.freeze({
    table: "tenant_security_audit_events",
    tenantColumn: "tenant_id",
    tenantColumnNullable: false,
    applicationRole: "booking_app",
  }),
]) satisfies readonly TenantOwnedTablePolicy[];
