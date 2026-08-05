import type { PoolClient, QueryResultRow } from "pg";

import type { TenantOwnedTablePolicy } from "./tenant-policy-manifest.js";

const REQUIRED_PRIVILEGES = Object.freeze(["DELETE", "INSERT", "SELECT", "UPDATE"]);

interface TableRow extends QueryResultRow {
  readonly rls_enabled: boolean;
  readonly rls_forced: boolean;
}

interface ColumnRow extends QueryResultRow {
  readonly column_name: string;
  readonly is_nullable: "YES" | "NO";
}

interface IndexRow extends QueryResultRow {
  readonly indexdef: string;
}

interface PolicyRow extends QueryResultRow {
  readonly policyname: string;
  readonly roles: readonly string[] | string;
  readonly qual: string | null;
  readonly with_check: string | null;
}

interface GrantRow extends QueryResultRow {
  readonly privilege_type: string;
}

interface RoleRow extends QueryResultRow {
  readonly rolsuper: boolean;
  readonly rolbypassrls: boolean;
}

function normalizeIdentifier(value: string): string {
  return value.replaceAll('"', "").toLowerCase();
}

function expressionReferencesTenant(expression: string | null, tenantColumn: string): boolean {
  if (!expression) {
    return false;
  }

  const normalized = normalizeIdentifier(expression);
  const settingPattern =
    /current_setting\s*\(\s*'app\.tenant_id'(?:::[a-z0-9_ ]+)?\s*,\s*true\s*\)/i;

  return settingPattern.test(normalized) && normalized.includes(tenantColumn.toLowerCase());
}

function policyAppliesToRole(roles: readonly string[] | string, applicationRole: string): boolean {
  const normalizedRoles =
    typeof roles === "string"
      ? roles
          .replace(/^\{|\}$/g, "")
          .split(",")
          .map((role) => role.trim().toLowerCase())
      : roles.map((role) => role.toLowerCase());

  return (
    normalizedRoles.includes("public") ||
    normalizedRoles.includes(applicationRole.toLowerCase())
  );
}

async function inspectTable(
  client: Pick<PoolClient, "query">,
  policy: TenantOwnedTablePolicy,
): Promise<readonly string[]> {
  const failures: string[] = [];
  const tableResult = await client.query<TableRow>(
    `SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = $1
        AND c.relkind = 'r'`,
    [policy.table],
  );

  const table = tableResult.rows[0];
  if (!table) {
    return [`${policy.table}: table is missing from public schema`];
  }

  if (!table.rls_enabled) {
    failures.push(`${policy.table}: row-level security is not enabled`);
  }
  if (!table.rls_forced) {
    failures.push(`${policy.table}: FORCE ROW LEVEL SECURITY is not enabled`);
  }

  const columnResult = await client.query<ColumnRow>(
    `SELECT column_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2`,
    [policy.table, policy.tenantColumn],
  );
  const column = columnResult.rows[0];
  if (!column) {
    failures.push(`${policy.table}.${policy.tenantColumn}: tenant column is missing`);
  } else {
    const actualNullable = column.is_nullable === "YES";
    if (actualNullable !== policy.tenantColumnNullable) {
      failures.push(
        `${policy.table}.${policy.tenantColumn}: expected nullable=${String(
          policy.tenantColumnNullable,
        )} but catalog reports nullable=${String(actualNullable)}`,
      );
    }
  }

  const indexResult = await client.query<IndexRow>(
    `SELECT indexdef
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = $1`,
    [policy.table],
  );
  if (
    !indexResult.rows.some((row) =>
      normalizeIdentifier(row.indexdef).includes(policy.tenantColumn.toLowerCase()),
    )
  ) {
    failures.push(`${policy.table}.${policy.tenantColumn}: tenant column index is missing`);
  }

  const policyResult = await client.query<PolicyRow>(
    `SELECT policyname, roles, qual, with_check
       FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = $1`,
    [policy.table],
  );
  const applicablePolicies = policyResult.rows.filter((row) =>
    policyAppliesToRole(row.roles, policy.applicationRole),
  );
  if (applicablePolicies.length === 0) {
    failures.push(`${policy.table}: no RLS policy applies to ${policy.applicationRole}`);
  } else {
    const hasTenantUsing = applicablePolicies.some((row) =>
      expressionReferencesTenant(row.qual, policy.tenantColumn),
    );
    const hasTenantWithCheck = applicablePolicies.some((row) =>
      expressionReferencesTenant(row.with_check, policy.tenantColumn),
    );
    const hasCompleteTenantPolicy = applicablePolicies.some(
      (row) =>
        expressionReferencesTenant(row.qual, policy.tenantColumn) &&
        expressionReferencesTenant(row.with_check, policy.tenantColumn),
    );

    if (!hasTenantUsing) {
      failures.push(`${policy.table}: RLS USING expression does not enforce app.tenant_id`);
    }
    if (!hasTenantWithCheck) {
      failures.push(`${policy.table}: RLS WITH CHECK expression does not enforce app.tenant_id`);
    }
    if (hasTenantUsing && hasTenantWithCheck && !hasCompleteTenantPolicy) {
      failures.push(
        `${policy.table}: no single RLS policy enforces app.tenant_id in both USING and WITH CHECK`,
      );
    }
  }

  const grantResult = await client.query<GrantRow>(
    `SELECT privilege_type
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = $1
        AND grantee = $2`,
    [policy.table, policy.applicationRole],
  );
  const actualPrivileges = [
    ...new Set(grantResult.rows.map((row) => row.privilege_type.toUpperCase())),
  ].sort();
  const missingPrivileges = REQUIRED_PRIVILEGES.filter(
    (privilege) => !actualPrivileges.includes(privilege),
  );
  const excessivePrivileges = actualPrivileges.filter(
    (privilege) => !REQUIRED_PRIVILEGES.includes(privilege),
  );
  if (missingPrivileges.length > 0) {
    failures.push(
      `${policy.table}: ${policy.applicationRole} is missing privileges ${missingPrivileges.join(
        ", ",
      )}`,
    );
  }
  if (excessivePrivileges.length > 0) {
    failures.push(
      `${policy.table}: ${policy.applicationRole} has excessive privileges ${excessivePrivileges.join(
        ", ",
      )}`,
    );
  }

  return failures;
}

async function inspectRole(
  client: Pick<PoolClient, "query">,
  applicationRole: string,
): Promise<readonly string[]> {
  const roleResult = await client.query<RoleRow>(
    `SELECT rolsuper, rolbypassrls
       FROM pg_roles
      WHERE rolname = $1`,
    [applicationRole],
  );
  const role = roleResult.rows[0];
  if (!role) {
    return [`${applicationRole}: application database role is missing`];
  }

  const failures: string[] = [];
  if (role.rolsuper) {
    failures.push(`${applicationRole}: application database role must not be superuser`);
  }
  if (role.rolbypassrls) {
    failures.push(`${applicationRole}: application database role must not have BYPASSRLS`);
  }
  return failures;
}

export async function verifyTenantPolicies(
  client: Pick<PoolClient, "query">,
  manifest: readonly TenantOwnedTablePolicy[],
): Promise<readonly string[]> {
  const failures: string[] = [];

  for (const policy of manifest) {
    failures.push(...(await inspectTable(client, policy)));
  }

  const roles = [...new Set(manifest.map((policy) => policy.applicationRole))].sort();
  for (const role of roles) {
    failures.push(...(await inspectRole(client, role)));
  }

  return failures.sort();
}
