import assert from "node:assert/strict";
import test from "node:test";

import type { PoolClient, QueryResult, QueryResultRow } from "pg";

import type { TenantOwnedTablePolicy } from "./tenant-policy-manifest.js";
import { verifyTenantPolicies } from "./tenant-policy-verifier.js";

const manifest: readonly TenantOwnedTablePolicy[] = [
  {
    table: "tenant_probes",
    tenantColumn: "tenant_id",
    tenantColumnNullable: false,
    applicationRole: "booking_app",
  },
];

interface CatalogFixture {
  readonly tables: readonly QueryResultRow[];
  readonly columns: readonly QueryResultRow[];
  readonly indexes: readonly QueryResultRow[];
  readonly policies: readonly QueryResultRow[];
  readonly grants: readonly QueryResultRow[];
  readonly roles: readonly QueryResultRow[];
}

const validPolicy = {
  policyname: "tenant_probe_isolation",
  roles: ["public"],
  qual:
    "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
  with_check:
    "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
} as const;

const validFixture: CatalogFixture = {
  tables: [{ rls_enabled: true, rls_forced: true }],
  columns: [{ column_name: "tenant_id", is_nullable: "NO" }],
  indexes: [{ has_tenant_index: true }],
  policies: [validPolicy],
  grants: [
    { grantee: "booking_app", privilege_type: "SELECT" },
    { grantee: "booking_app", privilege_type: "INSERT" },
    { grantee: "booking_app", privilege_type: "UPDATE" },
    { grantee: "booking_app", privilege_type: "DELETE" },
  ],
  roles: [{ rolsuper: false, rolbypassrls: false }],
};

function fixture(overrides: Partial<CatalogFixture> = {}): CatalogFixture {
  return { ...validFixture, ...overrides };
}

function fakeClient(catalog: CatalogFixture): Pick<PoolClient, "query"> {
  return {
    query: async <R extends QueryResultRow>(
      text: string,
    ): Promise<QueryResult<R>> => {
      let rows: readonly QueryResultRow[];
      if (text.includes("FROM pg_class")) {
        rows = catalog.tables;
      } else if (text.includes("information_schema.columns")) {
        rows = catalog.columns;
      } else if (text.includes("FROM pg_index i")) {
        rows = catalog.indexes;
      } else if (text.includes("FROM pg_policies")) {
        rows = catalog.policies;
      } else if (text.includes("information_schema.table_privileges")) {
        rows = catalog.grants;
      } else if (text.includes("FROM pg_roles")) {
        rows = catalog.roles;
      } else {
        throw new Error(`Unexpected catalog query: ${text}`);
      }

      return {
        command: "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
        rows: rows as R[],
      };
    },
  } as Pick<PoolClient, "query">;
}

async function failures(overrides: Partial<CatalogFixture> = {}): Promise<readonly string[]> {
  return verifyTenantPolicies(fakeClient(fixture(overrides)), manifest);
}

test("accepts a complete tenant policy catalog", async () => {
  assert.deepEqual(await failures(), []);
});

test("rejects a missing tenant-owned table", async () => {
  assert.deepEqual(await failures({ tables: [] }), [
    "tenant_probes: table is missing from public schema",
  ]);
});

test("rejects a missing tenant column", async () => {
  assert.ok(
    (await failures({ columns: [] })).some((failure) => failure.includes("column is missing")),
  );
});

test("rejects incorrect tenant-column nullability", async () => {
  assert.ok(
    (
      await failures({
        columns: [{ column_name: "tenant_id", is_nullable: "YES" }],
      })
    ).some((failure) => failure.includes("expected nullable=false")),
  );
});

test("rejects a missing tenant-column index", async () => {
  assert.ok(
    (await failures({ indexes: [] })).some((failure) => failure.includes("index is missing")),
  );
});

test("rejects disabled row-level security", async () => {
  assert.ok(
    (
      await failures({
        tables: [{ rls_enabled: false, rls_forced: true }],
      })
    ).some((failure) => failure.includes("row-level security is not enabled")),
  );
});

test("rejects disabled FORCE ROW LEVEL SECURITY", async () => {
  assert.ok(
    (
      await failures({
        tables: [{ rls_enabled: true, rls_forced: false }],
      })
    ).some((failure) => failure.includes("FORCE ROW LEVEL SECURITY")),
  );
});

test("rejects a missing applicable RLS policy", async () => {
  assert.ok(
    (await failures({ policies: [] })).some((failure) =>
      failure.includes("no RLS policy applies"),
    ),
  );
});

test("rejects a policy missing tenant-aware USING", async () => {
  assert.ok(
    (
      await failures({
        policies: [{ ...validPolicy, qual: null }],
      })
    ).some((failure) => failure.includes("USING expression")),
  );
});

test("rejects a policy missing tenant-aware WITH CHECK", async () => {
  assert.ok(
    (
      await failures({
        policies: [{ ...validPolicy, with_check: null }],
      })
    ).some((failure) => failure.includes("WITH CHECK expression")),
  );
});

test("rejects a superuser application role", async () => {
  assert.ok(
    (
      await failures({
        roles: [{ rolsuper: true, rolbypassrls: false }],
      })
    ).some((failure) => failure.includes("must not be superuser")),
  );
});

test("rejects an application role with BYPASSRLS", async () => {
  assert.ok(
    (
      await failures({
        roles: [{ rolsuper: false, rolbypassrls: true }],
      })
    ).some((failure) => failure.includes("must not have BYPASSRLS")),
  );
});

test("rejects excessive table grants", async () => {
  assert.ok(
    (
      await failures({
        grants: [...validFixture.grants, { grantee: "booking_app", privilege_type: "TRUNCATE" }],
      })
    ).some((failure) => failure.includes("excessive privileges TRUNCATE")),
  );
});

test("rejects missing required CRUD grants", async () => {
  assert.ok(
    (
      await failures({
        grants: validFixture.grants.filter((grant) => grant.privilege_type !== "DELETE"),
      })
    ).some((failure) => failure.includes("missing privileges DELETE")),
  );
});

test("rejects a missing application role", async () => {
  assert.deepEqual(await failures({ roles: [] }), [
    "booking_app: application database role is missing",
  ]);
});

test("rejects split tenant enforcement across separate policies", async () => {
  const splitPolicies = [
    { ...validPolicy, policyname: "tenant_read", with_check: null },
    { ...validPolicy, policyname: "tenant_write", qual: null },
  ];

  assert.ok(
    (await failures({ policies: splitPolicies })).some((failure) =>
      failure.includes("single RLS policy"),
    ),
  );
});

test("rejects an additional broad applicable policy", async () => {
  const broadPolicy = {
    ...validPolicy,
    policyname: "broad_access",
    qual: "true",
    with_check: "true",
  };

  assert.ok(
    (await failures({ policies: [validPolicy, broadPolicy] })).some((failure) =>
      failure.includes("applicable RLS policy"),
    ),
  );
});

test("rejects table privileges granted to PUBLIC", async () => {
  assert.ok(
    (
      await failures({
        grants: [
          ...validFixture.grants,
          { grantee: "PUBLIC", privilege_type: "SELECT" },
        ],
      })
    ).some((failure) => failure.includes("PUBLIC has table privileges SELECT")),
  );
});

test("rejects an index on a similarly named non-tenant column", async () => {
  assert.ok(
    (
      await failures({
        indexes: [{ has_tenant_index: false }],
      })
    ).some((failure) => failure.includes("index is missing")),
  );
});

test("rejects a policy on a similarly named non-tenant column", async () => {
  const wrongColumnPolicy = {
    ...validPolicy,
    qual:
      "(tenant_id_backup = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
    with_check:
      "(tenant_id_backup = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
  };

  assert.ok(
    (
      await failures({
        policies: [wrongColumnPolicy],
      })
    ).some((failure) => failure.includes("USING expression")),
  );
});

