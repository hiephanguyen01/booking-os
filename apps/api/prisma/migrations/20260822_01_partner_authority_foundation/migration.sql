-- Sprint 3.1 Partner authority and persistence foundation.
-- Partner remains nested inside the tenant security boundary; PostgreSQL RLS isolates tenants.

ALTER TYPE identity_scope_type ADD VALUE IF NOT EXISTS 'partner';
ALTER TYPE role_scope_level ADD VALUE IF NOT EXISTS 'partner';

CREATE TYPE partner_type AS ENUM ('individual', 'company');
CREATE TYPE partner_application_status AS ENUM (
  'draft',
  'submitted',
  'changes_requested',
  'approved',
  'rejected'
);
CREATE TYPE partner_operational_status AS ENUM ('inactive', 'active', 'suspended', 'cancelled');
CREATE TYPE partner_membership_status AS ENUM ('active', 'suspended', 'revoked');

INSERT INTO "roles" ("id", "key", "scope_level", "is_system", "created_at", "updated_at")
VALUES
  ('00000000-0000-4000-8000-000000000104'::uuid, 'partner_owner', 'partner'::role_scope_level, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000105'::uuid, 'partner_admin', 'partner'::role_scope_level, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "scope_level" = EXCLUDED."scope_level",
    "is_system" = true,
    "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "permissions" ("id", "key", "scope_level", "description", "created_at", "updated_at")
VALUES
  ('00000000-0000-4000-8000-000000000229'::uuid, 'partner.profile.read', 'partner'::role_scope_level, 'Read the current Partner profile.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000230'::uuid, 'partner.profile.update', 'partner'::role_scope_level, 'Update the current Partner profile.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000231'::uuid, 'partner.application.read', 'partner'::role_scope_level, 'Read the current Partner application.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000232'::uuid, 'partner.application.submit', 'partner'::role_scope_level, 'Submit or resubmit the current Partner application.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000233'::uuid, 'partner.verification.read', 'partner'::role_scope_level, 'Read the current Partner verification state.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000234'::uuid, 'partner.verification.update', 'partner'::role_scope_level, 'Update Partner onboarding verification material.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000235'::uuid, 'partner.payout_account.read', 'partner'::role_scope_level, 'Read the current Partner payout account in masked form.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000236'::uuid, 'partner.payout_account.update', 'partner'::role_scope_level, 'Replace the current Partner payout account.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000237'::uuid, 'partner.review_finding.read', 'partner'::role_scope_level, 'Read review findings for the current Partner application.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000238'::uuid, 'tenant.partner.read', 'tenant'::role_scope_level, 'Read Partners in the current tenant.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000239'::uuid, 'tenant.partner.verification.read', 'tenant'::role_scope_level, 'Read Partner verification state in the current tenant.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000240'::uuid, 'tenant.partner.payout_account.read', 'tenant'::role_scope_level, 'Read masked Partner payout account metadata in the current tenant.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000241'::uuid, 'tenant.partner.application.review', 'tenant'::role_scope_level, 'Review Partner applications and request changes.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000242'::uuid, 'tenant.partner.application.approve', 'tenant'::role_scope_level, 'Approve Partner applications.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000243'::uuid, 'tenant.partner.application.reject', 'tenant'::role_scope_level, 'Reject Partner applications.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000244'::uuid, 'tenant.partner.lifecycle.suspend', 'tenant'::role_scope_level, 'Suspend an active Partner.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000245'::uuid, 'tenant.partner.lifecycle.reactivate', 'tenant'::role_scope_level, 'Reactivate a suspended Partner.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000246'::uuid, 'tenant.partner.lifecycle.cancel', 'tenant'::role_scope_level, 'Cancel an active or suspended Partner.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "scope_level" = EXCLUDED."scope_level",
    "description" = EXCLUDED."description",
    "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
JOIN "permissions" AS permission_row ON permission_row."key" IN (
  'partner.profile.read',
  'partner.profile.update',
  'partner.application.read',
  'partner.application.submit',
  'partner.verification.read',
  'partner.verification.update',
  'partner.payout_account.read',
  'partner.payout_account.update',
  'partner.review_finding.read'
)
WHERE role_row."key" = 'partner_owner'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
JOIN "permissions" AS permission_row ON permission_row."key" IN (
  'partner.profile.read',
  'partner.profile.update',
  'partner.application.read',
  'partner.application.submit',
  'partner.verification.read',
  'partner.verification.update',
  'partner.payout_account.read',
  'partner.review_finding.read'
)
WHERE role_row."key" = 'partner_admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
JOIN "permissions" AS permission_row ON permission_row."key" IN (
  'tenant.partner.read',
  'tenant.partner.verification.read',
  'tenant.partner.payout_account.read',
  'tenant.partner.application.review',
  'tenant.partner.application.approve',
  'tenant.partner.application.reject',
  'tenant.partner.lifecycle.suspend',
  'tenant.partner.lifecycle.reactivate',
  'tenant.partner.lifecycle.cancel'
)
WHERE role_row."key" = 'tenant_owner'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
JOIN "permissions" AS permission_row ON permission_row."key" IN (
  'tenant.partner.read',
  'tenant.partner.verification.read',
  'tenant.partner.payout_account.read',
  'tenant.partner.application.review',
  'tenant.partner.application.approve',
  'tenant.partner.application.reject'
)
WHERE role_row."key" = 'tenant_admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

CREATE TABLE "partners" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "type" partner_type NOT NULL,
  "application_status" partner_application_status NOT NULL DEFAULT 'draft',
  "operational_status" partner_operational_status NOT NULL DEFAULT 'inactive',
  "authorization_version" integer NOT NULL DEFAULT 1,
  "version" integer NOT NULL DEFAULT 1,
  "submitted_at" timestamptz(6),
  "approved_at" timestamptz(6),
  "suspended_at" timestamptz(6),
  "cancelled_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partners_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partners_authorization_version_check" CHECK ("authorization_version" >= 1),
  CONSTRAINT "partners_version_check" CHECK ("version" >= 1),
  CONSTRAINT "partners_id_tenant_id_key" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "partners_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "partners_tenant_id_application_status_idx"
  ON "partners" ("tenant_id", "application_status");
CREATE INDEX "partners_tenant_id_operational_status_idx"
  ON "partners" ("tenant_id", "operational_status");

CREATE TABLE "partner_memberships" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "tenant_membership_id" uuid NOT NULL,
  "status" partner_membership_status NOT NULL DEFAULT 'active',
  "authorization_version" integer NOT NULL DEFAULT 1,
  "suspended_at" timestamptz(6),
  "revoked_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_memberships_authorization_version_check" CHECK ("authorization_version" >= 1),
  CONSTRAINT "partner_memberships_revoked_timestamp_check"
    CHECK ("status" <> 'revoked'::partner_membership_status OR "revoked_at" IS NOT NULL),
  CONSTRAINT "partner_memberships_id_partner_id_tenant_id_key" UNIQUE ("id", "partner_id", "tenant_id"),
  CONSTRAINT "partner_memberships_partner_id_tenant_membership_id_key" UNIQUE ("partner_id", "tenant_membership_id"),
  CONSTRAINT "partner_memberships_partner_tenant_fkey"
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_memberships_tenant_membership_tenant_fkey"
    FOREIGN KEY ("tenant_membership_id", "tenant_id")
    REFERENCES "tenant_memberships"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "partner_memberships_tenant_id_idx" ON "partner_memberships" ("tenant_id");
CREATE INDEX "partner_memberships_partner_id_idx" ON "partner_memberships" ("partner_id");
CREATE INDEX "partner_memberships_tenant_membership_id_idx"
  ON "partner_memberships" ("tenant_membership_id");

CREATE TABLE "partner_system_role_assignments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "partner_membership_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" timestamptz(6),
  CONSTRAINT "partner_system_role_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_system_role_assignments_membership_partner_tenant_fkey"
    FOREIGN KEY ("partner_membership_id", "partner_id", "tenant_id")
    REFERENCES "partner_memberships"("id", "partner_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_system_role_assignments_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "partner_system_role_assignments_active_key"
  ON "partner_system_role_assignments" ("tenant_id", "partner_id", "partner_membership_id", "role_id")
  WHERE "revoked_at" IS NULL;
CREATE INDEX "partner_system_role_assignments_tenant_id_idx"
  ON "partner_system_role_assignments" ("tenant_id");
CREATE INDEX "partner_system_role_assignments_partner_id_idx"
  ON "partner_system_role_assignments" ("partner_id");
CREATE INDEX "partner_system_role_assignments_partner_membership_id_idx"
  ON "partner_system_role_assignments" ("partner_membership_id");
CREATE INDEX "partner_system_role_assignments_role_id_idx"
  ON "partner_system_role_assignments" ("role_id");

ALTER TABLE "auth_sessions"
  ADD COLUMN "partner_id" uuid,
  ADD COLUMN "partner_authorization_version" integer,
  ADD COLUMN "partner_membership_authorization_version" integer;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_partner_tenant_fkey"
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "auth_sessions_partner_authorization_version_check"
    CHECK ("partner_authorization_version" IS NULL OR "partner_authorization_version" >= 1),
  ADD CONSTRAINT "auth_sessions_partner_membership_authorization_version_check"
    CHECK (
      "partner_membership_authorization_version" IS NULL
      OR "partner_membership_authorization_version" >= 1
    ),
  ADD CONSTRAINT "auth_sessions_partner_scope_shape_check"
    CHECK (
      (
        "scope_type" = 'partner'::identity_scope_type
        AND "tenant_id" IS NOT NULL
        AND "partner_id" IS NOT NULL
        AND "membership_authorization_version" IS NOT NULL
        AND "partner_authorization_version" IS NOT NULL
        AND "partner_membership_authorization_version" IS NOT NULL
      )
      OR
      (
        "scope_type" <> 'partner'::identity_scope_type
        AND "partner_id" IS NULL
        AND "partner_authorization_version" IS NULL
        AND "partner_membership_authorization_version" IS NULL
      )
    );
CREATE INDEX "auth_sessions_partner_id_idx" ON "auth_sessions" ("partner_id");

CREATE OR REPLACE FUNCTION prevent_partner_identity_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD."id" IS DISTINCT FROM NEW."id"
    OR OLD."tenant_id" IS DISTINCT FROM NEW."tenant_id" THEN
    RAISE EXCEPTION 'Partner identity cannot be modified' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "partners_prevent_identity_update"
BEFORE UPDATE OF "id", "tenant_id"
ON "partners"
FOR EACH ROW EXECUTE FUNCTION prevent_partner_identity_update();

CREATE OR REPLACE FUNCTION prevent_partner_membership_identity_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD."id" IS DISTINCT FROM NEW."id"
    OR OLD."tenant_id" IS DISTINCT FROM NEW."tenant_id"
    OR OLD."partner_id" IS DISTINCT FROM NEW."partner_id"
    OR OLD."tenant_membership_id" IS DISTINCT FROM NEW."tenant_membership_id" THEN
    RAISE EXCEPTION 'Partner membership identity cannot be modified' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "partner_memberships_prevent_identity_update"
BEFORE UPDATE OF "id", "tenant_id", "partner_id", "tenant_membership_id"
ON "partner_memberships"
FOR EACH ROW EXECUTE FUNCTION prevent_partner_membership_identity_update();

CREATE OR REPLACE FUNCTION prevent_partner_membership_reactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD."status" = 'revoked'::partner_membership_status
    AND NEW."status" <> 'revoked'::partner_membership_status THEN
    RAISE EXCEPTION 'revoked Partner membership cannot be reactivated' USING ERRCODE = '23514';
  END IF;
  IF OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS NULL THEN
    RAISE EXCEPTION 'revoked Partner membership cannot clear revoked_at' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "partner_memberships_prevent_reactivation"
BEFORE UPDATE OF "status", "revoked_at"
ON "partner_memberships"
FOR EACH ROW EXECUTE FUNCTION prevent_partner_membership_reactivation();

CREATE OR REPLACE FUNCTION validate_partner_system_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  role_scope role_scope_level;
  role_is_system boolean;
BEGIN
  SELECT "scope_level", "is_system"
  INTO role_scope, role_is_system
  FROM "roles"
  WHERE "id" = NEW."role_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner system role not found' USING ERRCODE = '23503';
  END IF;
  IF role_scope <> 'partner'::role_scope_level OR role_is_system IS NOT TRUE THEN
    RAISE EXCEPTION 'Partner assignments require a Partner system role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "partner_system_role_assignments_validate"
BEFORE INSERT OR UPDATE OF "role_id"
ON "partner_system_role_assignments"
FOR EACH ROW EXECUTE FUNCTION validate_partner_system_role_assignment();

CREATE OR REPLACE FUNCTION prevent_partner_system_role_assignment_identity_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD."id" IS DISTINCT FROM NEW."id"
    OR OLD."tenant_id" IS DISTINCT FROM NEW."tenant_id"
    OR OLD."partner_id" IS DISTINCT FROM NEW."partner_id"
    OR OLD."partner_membership_id" IS DISTINCT FROM NEW."partner_membership_id"
    OR OLD."role_id" IS DISTINCT FROM NEW."role_id" THEN
    RAISE EXCEPTION 'Partner system role assignment identity cannot be modified' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "partner_system_role_assignments_prevent_identity_update"
BEFORE UPDATE OF "id", "tenant_id", "partner_id", "partner_membership_id", "role_id"
ON "partner_system_role_assignments"
FOR EACH ROW EXECUTE FUNCTION prevent_partner_system_role_assignment_identity_update();

CREATE OR REPLACE FUNCTION prevent_partner_system_role_assignment_reactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS NULL THEN
    RAISE EXCEPTION 'revoked Partner system role assignment cannot be reactivated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "partner_system_role_assignments_prevent_reactivation"
BEFORE UPDATE OF "revoked_at"
ON "partner_system_role_assignments"
FOR EACH ROW EXECUTE FUNCTION prevent_partner_system_role_assignment_reactivation();

ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partners" FORCE ROW LEVEL SECURITY;
ALTER TABLE "partner_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "partner_system_role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_system_role_assignments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "partners_tenant_isolation" ON "partners"
FOR ALL TO booking_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "partner_memberships_tenant_isolation" ON "partner_memberships"
FOR ALL TO booking_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY "partner_system_role_assignments_tenant_isolation" ON "partner_system_role_assignments"
FOR ALL TO booking_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL PRIVILEGES ON TABLE "partners" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_memberships" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_system_role_assignments" FROM booking_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "partners" TO booking_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "partner_memberships" TO booking_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "partner_system_role_assignments" TO booking_app;

REVOKE ALL ON FUNCTION prevent_partner_identity_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_partner_membership_identity_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_partner_membership_reactivation() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_partner_system_role_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_partner_system_role_assignment_identity_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_partner_system_role_assignment_reactivation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prevent_partner_identity_update() TO booking_app;
GRANT EXECUTE ON FUNCTION prevent_partner_membership_identity_update() TO booking_app;
GRANT EXECUTE ON FUNCTION prevent_partner_membership_reactivation() TO booking_app;
GRANT EXECUTE ON FUNCTION validate_partner_system_role_assignment() TO booking_app;
GRANT EXECUTE ON FUNCTION prevent_partner_system_role_assignment_identity_update() TO booking_app;
GRANT EXECUTE ON FUNCTION prevent_partner_system_role_assignment_reactivation() TO booking_app;
