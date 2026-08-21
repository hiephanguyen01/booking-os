-- Sprint 3A Partner onboarding and authorization persistence foundation.
-- Partner-owned rows remain tenant isolated through the canonical app.tenant_id RLS boundary.
-- Partner scope is an application authorization boundary; the database has no Partner-specific scope setting.

ALTER TYPE "identity_scope_type" ADD VALUE IF NOT EXISTS 'partner';
ALTER TYPE "role_scope_level" ADD VALUE IF NOT EXISTS 'partner';

CREATE TYPE "partner_type" AS ENUM ('individual', 'company');
CREATE TYPE "partner_status" AS ENUM (
  'draft',
  'pending_review',
  'active',
  'inactive',
  'suspended',
  'cancelled'
);
CREATE TYPE "partner_membership_status" AS ENUM ('invited', 'active', 'suspended', 'revoked');
CREATE TYPE "partner_membership_invitation_status" AS ENUM (
  'pending',
  'accepted',
  'revoked',
  'expired'
);
CREATE TYPE "partner_verification_check_type" AS ENUM (
  'identity',
  'business_registration',
  'payout_account',
  'management_rights'
);
CREATE TYPE "partner_verification_check_status" AS ENUM (
  'pending',
  'submitted',
  'verified',
  'rejected'
);
CREATE TYPE "partner_payout_account_status" AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE "partner_review_outcome" AS ENUM ('changes_requested', 'approved', 'rejected');

CREATE TABLE "partners" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "type" "partner_type" NOT NULL,
  "display_name" TEXT NOT NULL,
  "legal_name" TEXT,
  "business_registration_no" TEXT,
  "contact_email" TEXT,
  "contact_phone" TEXT,
  "status" "partner_status" NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "approved_at" TIMESTAMPTZ(6),
  "suspended_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partners_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partners_id_tenant_id_key" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "partners_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partners_display_name_check" CHECK (length(btrim("display_name")) > 0),
  CONSTRAINT "partners_version_check" CHECK ("version" > 0)
);
CREATE INDEX "partners_tenant_id_status_idx" ON "partners" ("tenant_id", "status");
CREATE INDEX "partners_tenant_id_created_at_idx" ON "partners" ("tenant_id", "created_at");

CREATE TABLE "partner_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "partner_membership_status" NOT NULL DEFAULT 'invited',
  "authorization_version" INTEGER NOT NULL DEFAULT 1,
  "accepted_at" TIMESTAMPTZ(6),
  "suspended_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_memberships_partner_user_key" UNIQUE ("partner_id", "user_id"),
  CONSTRAINT "partner_memberships_id_tenant_partner_key" UNIQUE ("id", "tenant_id", "partner_id"),
  CONSTRAINT "partner_memberships_partner_tenant_fkey"
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_memberships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_memberships_authorization_version_check" CHECK ("authorization_version" > 0),
  CONSTRAINT "partner_memberships_lifecycle_check" CHECK (
    (
      "status" = 'invited'
      AND "accepted_at" IS NULL
      AND "suspended_at" IS NULL
      AND "revoked_at" IS NULL
    )
    OR
    (
      "status" = 'active'
      AND "accepted_at" IS NOT NULL
      AND "suspended_at" IS NULL
      AND "revoked_at" IS NULL
    )
    OR
    (
      "status" = 'suspended'
      AND "accepted_at" IS NOT NULL
      AND "suspended_at" IS NOT NULL
      AND "revoked_at" IS NULL
    )
    OR
    (
      "status" = 'revoked'
      AND "revoked_at" IS NOT NULL
    )
  )
);
CREATE INDEX "partner_memberships_tenant_partner_status_idx"
  ON "partner_memberships" ("tenant_id", "partner_id", "status");
CREATE INDEX "partner_memberships_user_id_idx" ON "partner_memberships" ("user_id");

CREATE TABLE "partner_membership_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "normalized_email" TEXT NOT NULL,
  "invited_user_id" UUID,
  "intended_role_key" TEXT NOT NULL,
  "status" "partner_membership_invitation_status" NOT NULL DEFAULT 'pending',
  "hostname" TEXT NOT NULL,
  "selector" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "invited_by_user_id" UUID NOT NULL,
  "invited_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_membership_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_membership_invitations_selector_key" UNIQUE ("selector"),
  CONSTRAINT "partner_membership_invitations_partner_tenant_fkey"
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_membership_invitations_invited_user_id_fkey"
    FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "partner_membership_invitations_invited_by_user_id_fkey"
    FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_membership_invitations_inviter_membership_fkey"
    FOREIGN KEY ("invited_by_membership_id", "tenant_id", "partner_id")
    REFERENCES "partner_memberships"("id", "tenant_id", "partner_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_membership_invitations_intended_role_key_fkey"
    FOREIGN KEY ("intended_role_key") REFERENCES "roles"("key") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_membership_invitations_email_check" CHECK (
    "normalized_email" = lower(btrim("normalized_email")) AND length("normalized_email") > 0
  ),
  CONSTRAINT "partner_membership_invitations_role_check" CHECK ("intended_role_key" = 'partner_member'),
  CONSTRAINT "partner_membership_invitations_hostname_check" CHECK (
    "hostname" = lower(btrim("hostname")) AND length("hostname") BETWEEN 1 AND 253
  ),
  CONSTRAINT "partner_membership_invitations_selector_check" CHECK (length(btrim("selector")) > 0),
  CONSTRAINT "partner_membership_invitations_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "partner_membership_invitations_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "partner_membership_invitations_lifecycle_check" CHECK (
    ("status" = 'pending' AND "consumed_at" IS NULL AND "revoked_at" IS NULL)
    OR ("status" = 'accepted' AND "consumed_at" IS NOT NULL AND "revoked_at" IS NULL)
    OR ("status" = 'revoked' AND "consumed_at" IS NULL AND "revoked_at" IS NOT NULL)
    OR ("status" = 'expired' AND "consumed_at" IS NULL AND "revoked_at" IS NULL)
  )
);
CREATE INDEX "partner_membership_invitations_tenant_partner_idx"
  ON "partner_membership_invitations" ("tenant_id", "partner_id");
CREATE INDEX "partner_membership_invitations_invited_user_id_idx"
  ON "partner_membership_invitations" ("invited_user_id");
CREATE INDEX "partner_membership_invitations_invited_by_user_id_idx"
  ON "partner_membership_invitations" ("invited_by_user_id");
CREATE INDEX "partner_membership_invitations_expires_at_idx"
  ON "partner_membership_invitations" ("expires_at");
CREATE UNIQUE INDEX "partner_membership_invitations_one_pending_email_key"
  ON "partner_membership_invitations" ("tenant_id", "partner_id", "normalized_email")
  WHERE "status" = 'pending';

CREATE TABLE "partner_registration_verifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "hostname" TEXT NOT NULL,
  "selector" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_registration_verifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_registration_verifications_selector_key" UNIQUE ("selector"),
  CONSTRAINT "partner_registration_verifications_partner_tenant_fkey"
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_registration_verifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_registration_verifications_hostname_check" CHECK (
    "hostname" = lower(btrim("hostname")) AND length("hostname") BETWEEN 1 AND 253
  ),
  CONSTRAINT "partner_registration_verifications_selector_check" CHECK (length(btrim("selector")) > 0),
  CONSTRAINT "partner_registration_verifications_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "partner_registration_verifications_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "partner_registration_verifications_lifecycle_check" CHECK (
    "consumed_at" IS NULL OR "revoked_at" IS NULL
  )
);
CREATE INDEX "partner_registration_verifications_tenant_partner_idx"
  ON "partner_registration_verifications" ("tenant_id", "partner_id");
CREATE INDEX "partner_registration_verifications_user_id_idx"
  ON "partner_registration_verifications" ("user_id");
CREATE INDEX "partner_registration_verifications_expires_at_idx"
  ON "partner_registration_verifications" ("expires_at");
CREATE UNIQUE INDEX "partner_registration_verifications_one_active_key"
  ON "partner_registration_verifications" ("tenant_id", "partner_id", "user_id", "hostname")
  WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;

CREATE TABLE "partner_verification_checks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "check_type" "partner_verification_check_type" NOT NULL,
  "status" "partner_verification_check_status" NOT NULL DEFAULT 'pending',
  "evidence_reference" TEXT,
  "reviewed_by_user_id" UUID,
  "submitted_at" TIMESTAMPTZ(6),
  "reviewed_at" TIMESTAMPTZ(6),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_verification_checks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_verification_checks_partner_tenant_fkey"
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_verification_checks_reviewer_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "partner_verification_checks_partner_type_key"
    UNIQUE ("tenant_id", "partner_id", "check_type")
);
CREATE INDEX "partner_verification_checks_tenant_partner_status_idx"
  ON "partner_verification_checks" ("tenant_id", "partner_id", "status");
CREATE INDEX "partner_verification_checks_reviewed_by_user_id_idx"
  ON "partner_verification_checks" ("reviewed_by_user_id");

CREATE TABLE "partner_payout_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "status" "partner_payout_account_status" NOT NULL DEFAULT 'pending',
  "account_reference" TEXT,
  "verified_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_payout_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_payout_accounts_partner_key" UNIQUE ("partner_id", "tenant_id"),
  CONSTRAINT "partner_payout_accounts_partner_tenant_fkey"
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "partner_payout_accounts_tenant_status_idx"
  ON "partner_payout_accounts" ("tenant_id", "status");

CREATE TABLE "partner_review_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "partner_version" INTEGER NOT NULL,
  "outcome" "partner_review_outcome" NOT NULL,
  "reason_code" TEXT,
  "reason" TEXT,
  "actor_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_review_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_review_decisions_partner_tenant_fkey"
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_review_decisions_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_review_decisions_partner_version_check" CHECK ("partner_version" > 0)
);
CREATE INDEX "partner_review_decisions_tenant_partner_created_idx"
  ON "partner_review_decisions" ("tenant_id", "partner_id", "created_at");
CREATE INDEX "partner_review_decisions_actor_id_idx" ON "partner_review_decisions" ("actor_id");

CREATE TABLE "partner_lifecycle_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "partner_id" UUID NOT NULL,
  "previous_status" "partner_status",
  "next_status" "partner_status" NOT NULL,
  "actor_id" UUID,
  "reason_code" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_lifecycle_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_lifecycle_history_partner_tenant_fkey"
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_lifecycle_history_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "partner_lifecycle_history_transition_check" CHECK (
    "previous_status" IS NULL OR "previous_status" <> "next_status"
  )
);
CREATE INDEX "partner_lifecycle_history_tenant_partner_created_idx"
  ON "partner_lifecycle_history" ("tenant_id", "partner_id", "created_at");
CREATE INDEX "partner_lifecycle_history_actor_id_idx" ON "partner_lifecycle_history" ("actor_id");

-- Add the Partner selector to all persisted authorization scope-bearing records.
ALTER TABLE "auth_sessions" ADD COLUMN "partner_id" UUID;
ALTER TABLE "auth_session_tokens" ADD COLUMN "partner_id" UUID;
ALTER TABLE "role_assignments" ADD COLUMN "partner_id" UUID;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_partner_tenant_fkey"
  FOREIGN KEY ("partner_id", "tenant_id")
  REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_session_tokens"
  ADD CONSTRAINT "auth_session_tokens_partner_tenant_fkey"
  FOREIGN KEY ("partner_id", "tenant_id")
  REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_assignments"
  ADD CONSTRAINT "role_assignments_partner_tenant_fkey"
  FOREIGN KEY ("partner_id", "tenant_id")
  REFERENCES "partners"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "auth_sessions_partner_id_idx" ON "auth_sessions" ("partner_id");
CREATE INDEX "auth_session_tokens_partner_id_idx" ON "auth_session_tokens" ("partner_id");
CREATE INDEX "role_assignments_partner_id_idx" ON "role_assignments" ("partner_id");

ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_scope_check";
ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_scope_check" CHECK (
    ("scope_type" = 'platform' AND "tenant_id" IS NULL AND "partner_id" IS NULL)
    OR
    ("scope_type" = 'tenant' AND "tenant_id" IS NOT NULL AND "partner_id" IS NULL)
    OR
    ("scope_type" = 'partner' AND "tenant_id" IS NOT NULL AND "partner_id" IS NOT NULL)
  );

ALTER TABLE "auth_session_tokens" DROP CONSTRAINT "auth_session_tokens_scope_check";
ALTER TABLE "auth_session_tokens"
  ADD CONSTRAINT "auth_session_tokens_scope_check" CHECK (
    ("scope_type" = 'platform' AND "tenant_id" IS NULL AND "partner_id" IS NULL)
    OR
    ("scope_type" = 'tenant' AND "tenant_id" IS NOT NULL AND "partner_id" IS NULL)
    OR
    ("scope_type" = 'partner' AND "tenant_id" IS NOT NULL AND "partner_id" IS NOT NULL)
  );

ALTER TABLE "role_assignments" DROP CONSTRAINT "role_assignments_scope_check";
ALTER TABLE "role_assignments"
  ADD CONSTRAINT "role_assignments_scope_check" CHECK (
    ("scope_level" = 'platform' AND "tenant_id" IS NULL AND "partner_id" IS NULL)
    OR
    ("scope_level" = 'tenant' AND "tenant_id" IS NOT NULL AND "partner_id" IS NULL)
    OR
    ("scope_level" = 'partner' AND "tenant_id" IS NOT NULL AND "partner_id" IS NOT NULL)
  );

DROP INDEX "role_assignments_one_active_scope_key";
CREATE UNIQUE INDEX "role_assignments_one_active_scope_key"
  ON "role_assignments" (
    "user_id", "role_id", "scope_level", "tenant_id", "partner_id"
  ) NULLS NOT DISTINCT
  WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX "role_assignments_one_active_partner_role_key"
  ON "role_assignments" ("tenant_id", "partner_id", "user_id")
  WHERE "scope_level" = 'partner' AND "revoked_at" IS NULL;

-- Keep session-token exact scope coupled to its opaque session family, now including Partner.
DROP TRIGGER "auth_session_tokens_scope_match_trigger" ON "auth_session_tokens";
CREATE OR REPLACE FUNCTION "enforce_auth_session_token_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_scope "identity_scope_type";
  parent_tenant UUID;
  parent_partner UUID;
BEGIN
  SELECT "scope_type", "tenant_id", "partner_id"
  INTO parent_scope, parent_tenant, parent_partner
  FROM "auth_sessions"
  WHERE "id" = NEW."session_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session family is unavailable for token scope validation'
      USING ERRCODE = '23503';
  END IF;

  IF parent_scope <> NEW."scope_type"
    OR parent_tenant IS DISTINCT FROM NEW."tenant_id"
    OR parent_partner IS DISTINCT FROM NEW."partner_id" THEN
    RAISE EXCEPTION 'session token scope does not match its family'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER "auth_session_tokens_scope_match_trigger"
BEFORE INSERT OR UPDATE OF "session_id", "scope_type", "tenant_id", "partner_id"
ON "auth_session_tokens"
FOR EACH ROW
EXECUTE FUNCTION "enforce_auth_session_token_scope"();

-- System-role assignments are valid only at the Role's exact scope. Partner assignments
-- additionally require an active membership for the same user/tenant/Partner tuple.
DROP TRIGGER "role_assignments_validate_scope" ON "role_assignments";
CREATE OR REPLACE FUNCTION "validate_role_assignment_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  expected_scope public.role_scope_level;
BEGIN
  SELECT role_row."scope_level"
    INTO expected_scope
    FROM public."roles" AS role_row
   WHERE role_row."id" = NEW."role_id";

  IF expected_scope IS NOT NULL AND expected_scope <> NEW."scope_level" THEN
    RAISE EXCEPTION 'role assignment scope does not match role scope'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."scope_level" = 'tenant'
     AND NEW."revoked_at" IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."tenant_memberships" AS membership
        WHERE membership."tenant_id" = NEW."tenant_id"
          AND membership."user_id" = NEW."user_id"
          AND membership."status" = 'active'
     ) THEN
    RAISE EXCEPTION 'active tenant membership is required for a tenant role assignment'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."scope_level" = 'partner'
     AND NEW."revoked_at" IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."partner_memberships" AS membership
        WHERE membership."tenant_id" = NEW."tenant_id"
          AND membership."partner_id" = NEW."partner_id"
          AND membership."user_id" = NEW."user_id"
          AND membership."status" = 'active'
     ) THEN
    RAISE EXCEPTION 'active Partner membership is required for a Partner role assignment'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER "role_assignments_validate_scope"
BEFORE INSERT OR UPDATE OF "user_id", "role_id", "scope_level", "tenant_id", "partner_id", "revoked_at"
ON "role_assignments"
FOR EACH ROW
EXECUTE FUNCTION "validate_role_assignment_scope"();

-- FORCE RLS on every Partner-owned table. The database boundary remains tenant-only.
ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partners" FORCE ROW LEVEL SECURITY;
ALTER TABLE "partner_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "partner_membership_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_membership_invitations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "partner_registration_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_registration_verifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "partner_verification_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_verification_checks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "partner_payout_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_payout_accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "partner_review_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_review_decisions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "partner_lifecycle_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_lifecycle_history" FORCE ROW LEVEL SECURITY;

CREATE POLICY "partners_tenant_isolation" ON "partners"
  FOR ALL TO booking_app
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "partner_memberships_tenant_isolation" ON "partner_memberships"
  FOR ALL TO booking_app
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "partner_membership_invitations_tenant_isolation" ON "partner_membership_invitations"
  FOR ALL TO booking_app
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "partner_registration_verifications_tenant_isolation" ON "partner_registration_verifications"
  FOR ALL TO booking_app
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "partner_verification_checks_tenant_isolation" ON "partner_verification_checks"
  FOR ALL TO booking_app
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "partner_payout_accounts_tenant_isolation" ON "partner_payout_accounts"
  FOR ALL TO booking_app
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "partner_review_decisions_tenant_isolation" ON "partner_review_decisions"
  FOR ALL TO booking_app
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "partner_lifecycle_history_tenant_isolation" ON "partner_lifecycle_history"
  FOR ALL TO booking_app
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL PRIVILEGES ON TABLE "partners" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "partner_memberships" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "partner_membership_invitations" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "partner_registration_verifications" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "partner_verification_checks" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "partner_payout_accounts" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "partner_review_decisions" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "partner_lifecycle_history" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "partners" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_memberships" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_membership_invitations" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_registration_verifications" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_verification_checks" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_payout_accounts" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_review_decisions" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_lifecycle_history" FROM booking_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "partners" TO booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "partner_memberships" TO booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "partner_membership_invitations" TO booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "partner_registration_verifications" TO booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "partner_verification_checks" TO booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "partner_payout_accounts" TO booking_app;
GRANT SELECT, INSERT ON TABLE "partner_review_decisions" TO booking_app;
GRANT SELECT, INSERT ON TABLE "partner_lifecycle_history" TO booking_app;

-- Persist the code-owned Sprint 3A authorization catalog so migration-only environments
-- and seeded development environments resolve the exact same immutable system roles.
INSERT INTO "roles" ("id", "key", "scope_level", "is_system", "created_at", "updated_at")
VALUES
  ('00000000-0000-4000-8000-000000000104'::uuid, 'partner_owner', 'partner'::role_scope_level, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000105'::uuid, 'partner_member', 'partner'::role_scope_level, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "scope_level" = EXCLUDED."scope_level",
  "is_system" = TRUE,
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "permissions" ("id", "key", "scope_level", "description", "created_at", "updated_at")
VALUES
  ('00000000-0000-4000-8000-000000000229'::uuid, 'tenant.partner.read', 'tenant'::role_scope_level, 'Read tenant Partners.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000230'::uuid, 'tenant.partner.review', 'tenant'::role_scope_level, 'Review tenant Partner onboarding submissions.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000231'::uuid, 'tenant.partner.approve', 'tenant'::role_scope_level, 'Approve tenant Partners.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000232'::uuid, 'tenant.partner.suspend', 'tenant'::role_scope_level, 'Suspend tenant Partners.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000233'::uuid, 'partner.profile.read', 'partner'::role_scope_level, 'Read the active Partner profile.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000234'::uuid, 'partner.profile.update', 'partner'::role_scope_level, 'Update the active Partner profile.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000235'::uuid, 'partner.membership.read', 'partner'::role_scope_level, 'Read Partner memberships.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000236'::uuid, 'partner.membership.invite', 'partner'::role_scope_level, 'Invite Partner members.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000237'::uuid, 'partner.membership.revoke', 'partner'::role_scope_level, 'Revoke Partner members.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "scope_level" = EXCLUDED."scope_level",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
JOIN "permissions" AS permission_row ON permission_row."key" IN (
  'tenant.partner.read',
  'tenant.partner.review',
  'tenant.partner.approve',
  'tenant.partner.suspend'
)
WHERE role_row."key" IN ('tenant_owner', 'tenant_admin')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
JOIN "permissions" AS permission_row ON permission_row."key" IN (
  'partner.profile.read',
  'partner.profile.update',
  'partner.membership.read',
  'partner.membership.invite',
  'partner.membership.revoke'
)
WHERE role_row."key" = 'partner_owner'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
JOIN "permissions" AS permission_row ON permission_row."key" IN (
  'partner.profile.read',
  'partner.membership.read'
)
WHERE role_row."key" = 'partner_member'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
