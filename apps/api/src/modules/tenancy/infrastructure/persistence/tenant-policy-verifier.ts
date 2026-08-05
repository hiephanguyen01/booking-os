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
  readonly has_tenant_index: boolean;
}

interface PolicyRow extends QueryResultRow {
  readonly policyname: string;
  readonly roles: readonly string[] | string;
  readonly qual: string | null;
  readonly with_check: string | null;
}

interface GrantRow extends QueryResultRow {
  readonly grantee: string;
  readonly privilege_type: string;
}

interface RoleRow extends QueryResultRow {
  readonly rolsuper: boolean;
  readonly rolbypassrls: boolean;
  readonly rolcanlogin: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolreplication: boolean;
}

interface MembershipRow extends QueryResultRow {
  readonly granted_role: string;
  readonly inherit_option: boolean;
  readonly set_option: boolean;
  readonly admin_option: boolean;
}

function normalizeIdentifier(value: string): string {
  return value.replaceAll('"', "").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expressionReferencesTenant(expression: string | null, tenantColumn: string): boolean {
  if (!expression) {
    return false;
  }

  const normalized = normalizeIdentifier(expression);
  const settingPattern =
    /current_setting\s*\(\s*'app\.tenant_id'(?:::[a-z0-9_ ]+)?\s*,\s*true\s*\)/i;
  if (!settingPattern.test(normalized)) {
    return false;
  }

  const expressionWithoutSettings = normalized.replace(
    /current_setting\s*\(\s*'app\.tenant_id'(?:::[a-z0-9_ ]+)?\s*,\s*true\s*\)/gi,
    "",
  );
  const tenantColumnPattern = new RegExp(
    `(?:^|[^a-z0-9_$])${escapeRegExp(tenantColumn.toLowerCase())}(?:[^a-z0-9_$]|$)`,
  );

  return tenantColumnPattern.test(expressionWithoutSettings);
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
    `SELECT EXISTS (
       SELECT 1
         FROM pg_index i
         JOIN pg_class table_class ON table_class.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = table_class.relnamespace
         JOIN LATERAL unnest(i.indkey::smallint[]) WITH ORDINALITY
           AS indexed_column(attnum, position)
           ON indexed_column.position <= i.indnkeyatts
         JOIN pg_attribute a
           ON a.attrelid = table_class.oid
          AND a.attnum = indexed_column.attnum
        WHERE n.nspname = 'public'
          AND table_class.relname = $1
          AND a.attname = $2
          AND i.indisvalid
          AND i.indisready
     ) AS has_tenant_index`,
    [policy.table, policy.tenantColumn],
  );
  if (indexResult.rows[0]?.has_tenant_index !== true) {
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
    const unsafeApplicablePolicies = applicablePolicies.filter(
      (row) =>
        !expressionReferencesTenant(row.qual, policy.tenantColumn) ||
        !expressionReferencesTenant(row.with_check, policy.tenantColumn),
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
    if (hasCompleteTenantPolicy && unsafeApplicablePolicies.length > 0) {
      failures.push(
        `${policy.table}: an applicable RLS policy does not enforce app.tenant_id in both USING and WITH CHECK`,
      );
    }
  }

  const grantResult = await client.query<GrantRow>(
    `SELECT grantee, privilege_type
       FROM information_schema.table_privileges
      WHERE table_schema = 'public'
        AND table_name = $1
        AND grantee IN ($2, 'PUBLIC')`,
    [policy.table, policy.applicationRole],
  );
  const applicationPrivileges = [
    ...new Set(
      grantResult.rows
        .filter((row) => row.grantee === policy.applicationRole)
        .map((row) => row.privilege_type.toUpperCase()),
    ),
  ].sort();
  const publicPrivileges = [
    ...new Set(
      grantResult.rows
        .filter((row) => row.grantee.toUpperCase() === "PUBLIC")
        .map((row) => row.privilege_type.toUpperCase()),
    ),
  ].sort();
  const missingPrivileges = REQUIRED_PRIVILEGES.filter(
    (privilege) => !applicationPrivileges.includes(privilege),
  );
  const excessivePrivileges = applicationPrivileges.filter(
    (privilege) => !REQUIRED_PRIVILEGES.includes(privilege),
  );
  if (publicPrivileges.length > 0) {
    failures.push(
      `${policy.table}: PUBLIC has table privileges ${publicPrivileges.join(", ")}`,
    );
  }
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
    `SELECT rolsuper,
            rolbypassrls,
            rolcanlogin,
            rolcreatedb,
            rolcreaterole,
            rolreplication
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
  if (role.rolcanlogin) {
    failures.push(`${applicationRole}: application database role must not allow LOGIN`);
  }
  if (role.rolcreatedb) {
    failures.push(`${applicationRole}: application database role must not have CREATEDB`);
  }
  if (role.rolcreaterole) {
    failures.push(`${applicationRole}: application database role must not have CREATEROLE`);
  }
  if (role.rolreplication) {
    failures.push(`${applicationRole}: application database role must not have REPLICATION`);
  }

  const membershipResult = await client.query<MembershipRow>(
    `SELECT granted_role.rolname AS granted_role,
            membership.inherit_option,
            membership.set_option,
            membership.admin_option
       FROM pg_auth_members membership
       JOIN pg_roles member_role ON member_role.oid = membership.member
       JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
      WHERE member_role.rolname = $1
      ORDER BY granted_role.rolname`,
    [applicationRole],
  );
  for (const membership of membershipResult.rows) {
    failures.push(
      `${applicationRole}: application database role must not be a member of role ${membership.granted_role} ` +
        `(INHERIT=${String(membership.inherit_option)}, SET=${String(
          membership.set_option,
        )}, ADMIN=${String(membership.admin_option)})`,
    );
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
