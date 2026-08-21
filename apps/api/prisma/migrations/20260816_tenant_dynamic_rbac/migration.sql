-- Sprint 2 tenant-scoped dynamic RBAC foundation.
-- System roles remain in the existing global role tables; tenant custom roles are isolated here.

INSERT INTO "permissions" ("id", "key", "scope_level", "description", "created_at", "updated_at")
VALUES
  ('00000000-0000-4000-8000-000000000219'::uuid, 'tenant.rbac.permission.read', 'tenant'::role_scope_level, 'Read tenant RBAC permissions.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000220'::uuid, 'tenant.rbac.role.read', 'tenant'::role_scope_level, 'Read tenant custom roles.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000221'::uuid, 'tenant.rbac.role.create', 'tenant'::role_scope_level, 'Create tenant custom roles.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000222'::uuid, 'tenant.rbac.role.update', 'tenant'::role_scope_level, 'Update tenant custom roles.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000223'::uuid, 'tenant.rbac.role.archive', 'tenant'::role_scope_level, 'Archive tenant custom roles.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000224'::uuid, 'tenant.rbac.role.permission.grant', 'tenant'::role_scope_level, 'Grant permissions to tenant custom roles.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000225'::uuid, 'tenant.rbac.role.permission.revoke', 'tenant'::role_scope_level, 'Revoke permissions from tenant custom roles.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000226'::uuid, 'tenant.rbac.assignment.read', 'tenant'::role_scope_level, 'Read tenant custom-role assignments.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000227'::uuid, 'tenant.rbac.assignment.grant', 'tenant'::role_scope_level, 'Grant tenant custom-role assignments.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000228'::uuid, 'tenant.rbac.assignment.revoke', 'tenant'::role_scope_level, 'Revoke tenant custom-role assignments.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
JOIN "permissions" AS permission_row ON permission_row."key" IN (
  'tenant.rbac.permission.read',
  'tenant.rbac.role.read',
  'tenant.rbac.role.create',
  'tenant.rbac.role.update',
  'tenant.rbac.role.archive',
  'tenant.rbac.role.permission.grant',
  'tenant.rbac.role.permission.revoke',
  'tenant.rbac.assignment.read',
  'tenant.rbac.assignment.grant',
  'tenant.rbac.assignment.revoke'
)
WHERE role_row."key" = 'tenant_owner'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
JOIN "permissions" AS permission_row ON permission_row."key" IN (
  'tenant.rbac.permission.read',
  'tenant.rbac.role.read',
  'tenant.rbac.assignment.read'
)
WHERE role_row."key" = 'tenant_admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Composite membership identity is required so assignment FKs cannot cross tenants.
ALTER TABLE "tenant_memberships"
  ADD CONSTRAINT "tenant_memberships_id_tenant_id_key" UNIQUE ("id", "tenant_id");

CREATE TABLE "tenant_custom_roles" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "description" text,
  "version" integer NOT NULL DEFAULT 1,
  "archived_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_custom_roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_custom_roles_version_check" CHECK ("version" >= 1),
  CONSTRAINT "tenant_custom_roles_id_tenant_id_key" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "tenant_custom_roles_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tenant_custom_roles_active_name_key"
  ON "tenant_custom_roles" ("tenant_id", "normalized_name")
  WHERE "archived_at" IS NULL;
CREATE INDEX "tenant_custom_roles_tenant_id_idx" ON "tenant_custom_roles" ("tenant_id");

CREATE TABLE "tenant_custom_role_permissions" (
  "tenant_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "permission_id" uuid NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_custom_role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id"),
  CONSTRAINT "tenant_custom_role_permissions_role_tenant_fkey"
    FOREIGN KEY ("role_id", "tenant_id")
    REFERENCES "tenant_custom_roles"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_custom_role_permissions_permission_id_fkey"
    FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "tenant_custom_role_permissions_tenant_id_idx"
  ON "tenant_custom_role_permissions" ("tenant_id");
CREATE INDEX "tenant_custom_role_permissions_permission_id_idx"
  ON "tenant_custom_role_permissions" ("permission_id");

CREATE TABLE "tenant_custom_role_assignments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "membership_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" timestamptz(6),
  CONSTRAINT "tenant_custom_role_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_custom_role_assignments_role_tenant_fkey"
    FOREIGN KEY ("role_id", "tenant_id")
    REFERENCES "tenant_custom_roles"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_custom_role_assignments_membership_tenant_fkey"
    FOREIGN KEY ("membership_id", "tenant_id")
    REFERENCES "tenant_memberships"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_custom_role_assignments_active_key"
  ON "tenant_custom_role_assignments" ("tenant_id", "membership_id", "role_id")
  WHERE "revoked_at" IS NULL;
CREATE INDEX "tenant_custom_role_assignments_tenant_id_idx"
  ON "tenant_custom_role_assignments" ("tenant_id");
CREATE INDEX "tenant_custom_role_assignments_membership_id_idx"
  ON "tenant_custom_role_assignments" ("membership_id");
CREATE INDEX "tenant_custom_role_assignments_role_id_idx"
  ON "tenant_custom_role_assignments" ("role_id");

CREATE OR REPLACE FUNCTION validate_tenant_custom_role_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  role_archived_at timestamptz;
  permission_scope role_scope_level;
BEGIN
  SELECT "archived_at" INTO role_archived_at
  FROM "tenant_custom_roles"
  WHERE "id" = NEW."role_id" AND "tenant_id" = NEW."tenant_id"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant custom role not found in tenant' USING ERRCODE = '23503';
  END IF;
  IF role_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'archived tenant custom role cannot gain permissions' USING ERRCODE = '23514';
  END IF;

  SELECT "scope_level" INTO permission_scope
  FROM "permissions"
  WHERE "id" = NEW."permission_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'permission not found' USING ERRCODE = '23503';
  END IF;
  IF permission_scope <> 'tenant'::role_scope_level THEN
    RAISE EXCEPTION 'tenant custom roles accept only tenant permissions' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tenant_custom_role_permissions_validate"
BEFORE INSERT OR UPDATE OF "tenant_id", "role_id", "permission_id"
ON "tenant_custom_role_permissions"
FOR EACH ROW EXECUTE FUNCTION validate_tenant_custom_role_permission();

CREATE OR REPLACE FUNCTION validate_tenant_custom_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  role_archived_at timestamptz;
  membership_status tenant_membership_status;
BEGIN
  SELECT "archived_at" INTO role_archived_at
  FROM "tenant_custom_roles"
  WHERE "id" = NEW."role_id" AND "tenant_id" = NEW."tenant_id"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant custom role not found in tenant' USING ERRCODE = '23503';
  END IF;
  IF role_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'archived tenant custom role cannot gain assignments' USING ERRCODE = '23514';
  END IF;

  SELECT "status" INTO membership_status
  FROM "tenant_memberships"
  WHERE "id" = NEW."membership_id" AND "tenant_id" = NEW."tenant_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant membership not found in tenant' USING ERRCODE = '23503';
  END IF;
  IF membership_status <> 'active'::tenant_membership_status THEN
    RAISE EXCEPTION 'tenant custom roles require active memberships' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tenant_custom_role_assignments_validate"
BEFORE INSERT OR UPDATE OF "tenant_id", "membership_id", "role_id"
ON "tenant_custom_role_assignments"
FOR EACH ROW EXECUTE FUNCTION validate_tenant_custom_role_assignment();

CREATE OR REPLACE FUNCTION prevent_tenant_custom_role_assignment_reactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS NULL THEN
    RAISE EXCEPTION 'revoked tenant custom role assignment cannot be reactivated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tenant_custom_role_assignments_prevent_reactivation"
BEFORE UPDATE OF "revoked_at"
ON "tenant_custom_role_assignments"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_custom_role_assignment_reactivation();

ALTER TABLE "tenant_custom_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_custom_roles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_custom_role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_custom_role_permissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_custom_role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_custom_role_assignments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_custom_roles_tenant_isolation" ON "tenant_custom_roles"
  FOR ALL TO booking_app
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY "tenant_custom_role_permissions_tenant_isolation" ON "tenant_custom_role_permissions"
  FOR ALL TO booking_app
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY "tenant_custom_role_assignments_tenant_isolation" ON "tenant_custom_role_assignments"
  FOR ALL TO booking_app
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

REVOKE ALL PRIVILEGES ON TABLE "tenant_custom_roles" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "tenant_custom_role_permissions" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "tenant_custom_role_assignments" FROM booking_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "tenant_custom_roles" TO booking_app;
GRANT SELECT, INSERT, DELETE ON TABLE "tenant_custom_role_permissions" TO booking_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "tenant_custom_role_assignments" TO booking_app;

REVOKE ALL ON FUNCTION validate_tenant_custom_role_permission() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_tenant_custom_role_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_tenant_custom_role_assignment_reactivation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_tenant_custom_role_permission() TO booking_app;
GRANT EXECUTE ON FUNCTION validate_tenant_custom_role_assignment() TO booking_app;
GRANT EXECUTE ON FUNCTION prevent_tenant_custom_role_assignment_reactivation() TO booking_app;