import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { Pool, type PoolClient } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://booking:booking@localhost:5432/booking_os_test";

const TENANT_A_ID = "6a000000-0000-4000-8000-000000000001";
const TENANT_B_ID = "6a000000-0000-4000-8000-000000000002";
const USER_A_ID = "6b000000-0000-4000-8000-000000000001";
const USER_B_ID = "6b000000-0000-4000-8000-000000000002";
const PARTNER_A_ID = "6c000000-0000-4000-8000-000000000001";
const PARTNER_B_ID = "6c000000-0000-4000-8000-000000000002";
const MEMBERSHIP_A_ID = "6d000000-0000-4000-8000-000000000001";
const MEMBERSHIP_B_ID = "6d000000-0000-4000-8000-000000000002";
const ROLE_ASSIGNMENT_ID = "6e000000-0000-4000-8000-000000000001";

const PARTNER_TABLES = [
  "partners",
  "partner_memberships",
  "partner_membership_invitations",
  "partner_registration_verifications",
  "partner_verification_checks",
  "partner_payout_accounts",
  "partner_review_decisions",
  "partner_lifecycle_history",
] as const;

const pool = new Pool({ connectionString: databaseUrl });

async function withTenant<T>(
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE booking_app");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function relationExists(table: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${table}`],
  );
  return result.rows[0]?.exists ?? false;
}

before(async () => {
  await pool.query(
    `INSERT INTO tenants (id, slug, name)
     VALUES
       ($1::uuid, 'partner-persistence-a', 'Partner Persistence A'),
       ($2::uuid, 'partner-persistence-b', 'Partner Persistence B')
     ON CONFLICT (id) DO UPDATE SET
       slug = EXCLUDED.slug,
       name = EXCLUDED.name`,
    [TENANT_A_ID, TENANT_B_ID],
  );

  await pool.query(
    `INSERT INTO users (
       id, normalized_email, display_email, status, authorization_version
     )
     VALUES
       ($1::uuid, 'partner-persistence-a@example.test', 'partner-persistence-a@example.test', 'active', 1),
       ($2::uuid, 'partner-persistence-b@example.test', 'partner-persistence-b@example.test', 'active', 1)
     ON CONFLICT (id) DO UPDATE SET
       status = 'active',
       authorization_version = 1`,
    [USER_A_ID, USER_B_ID],
  );
});

after(async () => {
  if (await relationExists("role_assignments")) {
    await pool.query("DELETE FROM role_assignments WHERE id = $1::uuid", [ROLE_ASSIGNMENT_ID]);
  }

  for (const tenantId of [TENANT_A_ID, TENANT_B_ID]) {
    if (await relationExists("partners")) {
      await withTenant(tenantId, async (client) => {
        await client.query(
          "DELETE FROM partners WHERE id IN ($1::uuid, $2::uuid)",
          [PARTNER_A_ID, PARTNER_B_ID],
        );
      });
    }
  }

  await pool.query("DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)", [USER_A_ID, USER_B_ID]);
  await pool.query("DELETE FROM tenants WHERE id IN ($1::uuid, $2::uuid)", [
    TENANT_A_ID,
    TENANT_B_ID,
  ]);
  await pool.end();
});

test("Partner persistence creates all tenant-owned tables with FORCE RLS", async () => {
  const result = await pool.query<{
    table_name: string;
    rls_enabled: boolean;
    rls_forced: boolean;
  }>(
    `SELECT c.relname AS table_name,
            c.relrowsecurity AS rls_enabled,
            c.relforcerowsecurity AS rls_forced
       FROM pg_class AS c
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname`,
    [PARTNER_TABLES],
  );

  assert.deepEqual(
    result.rows.map((row) => row.table_name),
    [...PARTNER_TABLES].sort(),
  );
  for (const row of result.rows) {
    assert.equal(row.rls_enabled, true, `${row.table_name} must enable RLS`);
    assert.equal(row.rls_forced, true, `${row.table_name} must FORCE RLS`);
  }
});

test("Partner rows are isolated by canonical tenant context", async () => {
  await withTenant(TENANT_A_ID, (client) =>
    client.query(
      `INSERT INTO partners (id, tenant_id, type, display_name)
       VALUES ($1::uuid, $2::uuid, 'individual', 'Partner A')`,
      [PARTNER_A_ID, TENANT_A_ID],
    ),
  );
  await withTenant(TENANT_B_ID, (client) =>
    client.query(
      `INSERT INTO partners (id, tenant_id, type, display_name)
       VALUES ($1::uuid, $2::uuid, 'company', 'Partner B')`,
      [PARTNER_B_ID, TENANT_B_ID],
    ),
  );

  const tenantAVisible = await withTenant(TENANT_A_ID, (client) =>
    client.query<{ id: string; tenant_id: string }>(
      "SELECT id, tenant_id FROM partners ORDER BY id",
    ),
  );
  assert.deepEqual(
    tenantAVisible.rows.map((row) => [row.id, row.tenant_id]),
    [[PARTNER_A_ID, TENANT_A_ID]],
  );

  await assert.rejects(
    withTenant(TENANT_A_ID, (client) =>
      client.query(
        `INSERT INTO partners (id, tenant_id, type, display_name)
         VALUES ('6c000000-0000-4000-8000-000000000099'::uuid, $1::uuid, 'individual', 'Forbidden')`,
        [TENANT_B_ID],
      ),
    ),
  );
});

test("missing app.tenant_id fails closed for Partner-owned rows", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE booking_app");
    const rows = await client.query("SELECT id FROM partners");
    assert.equal(rows.rowCount, 0);
    await assert.rejects(
      client.query(
        `INSERT INTO partners (id, tenant_id, type, display_name)
         VALUES ('6c000000-0000-4000-8000-000000000098'::uuid, $1::uuid, 'individual', 'No Context')`,
        [TENANT_A_ID],
      ),
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("the same global user can join different Partners while duplicate Partner membership is rejected", async () => {
  await withTenant(TENANT_A_ID, (client) =>
    client.query(
      `INSERT INTO partner_memberships (
         id, tenant_id, partner_id, user_id, status, accepted_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'active', CURRENT_TIMESTAMP)`,
      [MEMBERSHIP_A_ID, TENANT_A_ID, PARTNER_A_ID, USER_A_ID],
    ),
  );
  await withTenant(TENANT_B_ID, (client) =>
    client.query(
      `INSERT INTO partner_memberships (
         id, tenant_id, partner_id, user_id, status, accepted_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'active', CURRENT_TIMESTAMP)`,
      [MEMBERSHIP_B_ID, TENANT_B_ID, PARTNER_B_ID, USER_A_ID],
    ),
  );

  await assert.rejects(
    withTenant(TENANT_A_ID, (client) =>
      client.query(
        `INSERT INTO partner_memberships (
           tenant_id, partner_id, user_id, status, accepted_at
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'active', CURRENT_TIMESTAMP)`,
        [TENANT_A_ID, PARTNER_A_ID, USER_A_ID],
      ),
    ),
  );
});

test("composite Partner foreign keys reject cross-tenant relationships", async () => {
  await assert.rejects(
    withTenant(TENANT_A_ID, (client) =>
      client.query(
        `INSERT INTO partner_memberships (
           tenant_id, partner_id, user_id, status, accepted_at
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'active', CURRENT_TIMESTAMP)`,
        [TENANT_A_ID, PARTNER_B_ID, USER_B_ID],
      ),
    ),
  );

  await assert.rejects(
    withTenant(TENANT_A_ID, (client) =>
      client.query(
        `INSERT INTO partner_verification_checks (
           tenant_id, partner_id, check_type, status
         )
         VALUES ($1::uuid, $2::uuid, 'identity', 'pending')`,
        [TENANT_A_ID, PARTNER_B_ID],
      ),
    ),
  );
});

test("Partner role assignment shape and active-membership requirements fail closed", async () => {
  const role = await pool.query<{ id: string }>(
    "SELECT id FROM roles WHERE key = 'partner_owner'",
  );
  assert.equal(role.rowCount, 1);
  const partnerOwnerRoleId = role.rows[0]?.id;
  assert.ok(partnerOwnerRoleId);

  await withTenant(TENANT_A_ID, (client) =>
    client.query(
      `INSERT INTO role_assignments (
         id, user_id, role_id, scope_level, tenant_id, partner_id
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'partner', $4::uuid, $5::uuid)`,
      [ROLE_ASSIGNMENT_ID, USER_A_ID, partnerOwnerRoleId, TENANT_A_ID, PARTNER_A_ID],
    ),
  );

  await assert.rejects(
    withTenant(TENANT_A_ID, (client) =>
      client.query(
        `INSERT INTO role_assignments (
           user_id, role_id, scope_level, tenant_id, partner_id
         )
         VALUES ($1::uuid, $2::uuid, 'partner', $3::uuid, NULL)`,
        [USER_A_ID, partnerOwnerRoleId, TENANT_A_ID],
      ),
    ),
  );

  await assert.rejects(
    withTenant(TENANT_A_ID, (client) =>
      client.query(
        `INSERT INTO role_assignments (
           user_id, role_id, scope_level, tenant_id, partner_id
         )
         VALUES ($1::uuid, $2::uuid, 'partner', $3::uuid, $4::uuid)`,
        [USER_B_ID, partnerOwnerRoleId, TENANT_A_ID, PARTNER_A_ID],
      ),
    ),
  );
});

test("database authorization catalog matches Sprint 3A Task 1 vocabulary", async () => {
  const roles = await pool.query<{ key: string; scope_level: string }>(
    `SELECT key, scope_level
       FROM roles
      WHERE key IN ('partner_owner', 'partner_member')
      ORDER BY key`,
  );
  assert.deepEqual(roles.rows, [
    { key: "partner_member", scope_level: "partner" },
    { key: "partner_owner", scope_level: "partner" },
  ]);

  const mappings = await pool.query<{ role_key: string; permission_key: string }>(
    `SELECT r.key AS role_key, p.key AS permission_key
       FROM roles AS r
       JOIN role_permissions AS rp ON rp.role_id = r.id
       JOIN permissions AS p ON p.id = rp.permission_id
      WHERE r.key IN ('tenant_owner', 'tenant_admin', 'partner_owner', 'partner_member')
        AND (
          p.key LIKE 'tenant.partner.%'
          OR p.key LIKE 'partner.%'
        )
      ORDER BY r.key, p.key`,
  );

  assert.deepEqual(
    mappings.rows.map((row) => `${row.role_key}:${row.permission_key}`),
    [
      "partner_member:partner.membership.read",
      "partner_member:partner.profile.read",
      "partner_owner:partner.membership.invite",
      "partner_owner:partner.membership.read",
      "partner_owner:partner.membership.revoke",
      "partner_owner:partner.profile.read",
      "partner_owner:partner.profile.update",
      "tenant_admin:tenant.partner.approve",
      "tenant_admin:tenant.partner.read",
      "tenant_admin:tenant.partner.review",
      "tenant_admin:tenant.partner.suspend",
      "tenant_owner:tenant.partner.approve",
      "tenant_owner:tenant.partner.read",
      "tenant_owner:tenant.partner.review",
      "tenant_owner:tenant.partner.suspend",
    ],
  );
});
