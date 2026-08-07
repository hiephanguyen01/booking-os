CREATE TYPE "tenant_status" AS ENUM ('provisioning', 'active', 'suspended');
CREATE TYPE "tenant_membership_status" AS ENUM ('invited', 'active', 'suspended', 'revoked');
CREATE TYPE "membership_invitation_status" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

ALTER TABLE "tenants"
  ADD COLUMN "status" "tenant_status" NOT NULL DEFAULT 'provisioning';

CREATE INDEX "tenants_status_idx" ON "tenants" ("status");

CREATE TABLE "tenant_domains" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "hostname" TEXT NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_domains_hostname_check" CHECK (
    "hostname" = lower(btrim("hostname"))
    AND length("hostname") > 0
  ),
  CONSTRAINT "tenant_domains_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tenant_domains_hostname_key" ON "tenant_domains" ("hostname");
CREATE INDEX "tenant_domains_tenant_id_idx" ON "tenant_domains" ("tenant_id");
CREATE UNIQUE INDEX "tenant_domains_one_primary_key"
  ON "tenant_domains" ("tenant_id")
  WHERE "is_primary";

CREATE TABLE "tenant_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "tenant_membership_status" NOT NULL DEFAULT 'invited',
  "authorization_version" INTEGER NOT NULL DEFAULT 1,
  "accepted_at" TIMESTAMPTZ(6),
  "suspended_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_memberships_authorization_version_check" CHECK (
    "authorization_version" > 0
  ),
  CONSTRAINT "tenant_memberships_lifecycle_check" CHECK (
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
  ),
  CONSTRAINT "tenant_memberships_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_memberships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key"
  ON "tenant_memberships" ("tenant_id", "user_id");
CREATE INDEX "tenant_memberships_tenant_id_idx" ON "tenant_memberships" ("tenant_id");
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships" ("user_id");
CREATE INDEX "tenant_memberships_tenant_id_status_idx"
  ON "tenant_memberships" ("tenant_id", "status");

CREATE TABLE "membership_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "normalized_email" TEXT NOT NULL,
  "invited_user_id" UUID,
  "intended_role_key" TEXT NOT NULL,
  "status" "membership_invitation_status" NOT NULL DEFAULT 'pending',
  "hostname" TEXT NOT NULL,
  "selector" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "invited_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "membership_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "membership_invitations_email_check" CHECK (
    "normalized_email" = lower(btrim("normalized_email"))
    AND length("normalized_email") > 0
  ),
  CONSTRAINT "membership_invitations_hostname_check" CHECK (
    "hostname" = lower(btrim("hostname"))
    AND length("hostname") > 0
  ),
  CONSTRAINT "membership_invitations_role_check" CHECK (
    "intended_role_key" IN ('tenant_owner', 'tenant_admin')
  ),
  CONSTRAINT "membership_invitations_selector_check" CHECK (
    length(btrim("selector")) > 0
  ),
  CONSTRAINT "membership_invitations_hash_check" CHECK (
    "token_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "membership_invitations_expiry_check" CHECK (
    "expires_at" > "created_at"
  ),
  CONSTRAINT "membership_invitations_lifecycle_check" CHECK (
    (
      "status" = 'pending'
      AND "accepted_at" IS NULL
      AND "revoked_at" IS NULL
    )
    OR
    (
      "status" = 'accepted'
      AND "accepted_at" IS NOT NULL
      AND "revoked_at" IS NULL
    )
    OR
    (
      "status" = 'revoked'
      AND "accepted_at" IS NULL
      AND "revoked_at" IS NOT NULL
    )
    OR
    (
      "status" = 'expired'
      AND "accepted_at" IS NULL
      AND "revoked_at" IS NULL
    )
  ),
  CONSTRAINT "membership_invitations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "membership_invitations_invited_user_id_fkey"
    FOREIGN KEY ("invited_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "membership_invitations_invited_by_user_id_fkey"
    FOREIGN KEY ("invited_by_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "membership_invitations_intended_role_key_fkey"
    FOREIGN KEY ("intended_role_key") REFERENCES "roles" ("key") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "membership_invitations_selector_key"
  ON "membership_invitations" ("selector");
CREATE INDEX "membership_invitations_tenant_id_idx"
  ON "membership_invitations" ("tenant_id");
CREATE INDEX "membership_invitations_invited_user_id_idx"
  ON "membership_invitations" ("invited_user_id");
CREATE INDEX "membership_invitations_invited_by_user_id_idx"
  ON "membership_invitations" ("invited_by_user_id");
CREATE INDEX "membership_invitations_expires_at_idx"
  ON "membership_invitations" ("expires_at");
CREATE UNIQUE INDEX "membership_invitations_one_pending_email_role_key"
  ON "membership_invitations" ("tenant_id", "normalized_email", "intended_role_key")
  WHERE "status" = 'pending';

ALTER TABLE "account_activation_tokens"
  ADD CONSTRAINT "account_activation_tokens_invitation_id_fkey"
  FOREIGN KEY ("invitation_id") REFERENCES "membership_invitations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "role_assignments"
  DROP CONSTRAINT "role_assignments_platform_scope_check";

ALTER TABLE "role_assignments"
  ADD CONSTRAINT "role_assignments_scope_check" CHECK (
    (
      "scope_level" = 'platform'
      AND "tenant_id" IS NULL
    )
    OR
    (
      "scope_level" = 'tenant'
      AND "tenant_id" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "role_assignments_one_active_tenant_role_key"
  ON "role_assignments" ("tenant_id", "user_id")
  WHERE "scope_level" = 'tenant' AND "revoked_at" IS NULL;

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

  RETURN NEW;
END;
$$;

CREATE TRIGGER "role_assignments_validate_scope"
BEFORE INSERT OR UPDATE OF "user_id", "role_id", "scope_level", "tenant_id", "revoked_at"
ON "role_assignments"
FOR EACH ROW
EXECUTE FUNCTION "validate_role_assignment_scope"();

INSERT INTO "roles" (
  "id",
  "key",
  "scope_level",
  "is_system",
  "created_at",
  "updated_at"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000102',
    'tenant_owner',
    'tenant',
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000103',
    'tenant_admin',
    'tenant',
    TRUE,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO UPDATE SET
  "scope_level" = EXCLUDED."scope_level",
  "is_system" = EXCLUDED."is_system",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "permissions" (
  "id",
  "key",
  "scope_level",
  "description",
  "created_at",
  "updated_at"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000211',
    'tenant.membership.read',
    'tenant',
    'Read tenant memberships.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000212',
    'tenant.membership.admin.invite',
    'tenant',
    'Invite tenant administrators.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000213',
    'tenant.membership.admin.suspend',
    'tenant',
    'Suspend tenant administrators.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000214',
    'tenant.membership.admin.revoke',
    'tenant',
    'Revoke tenant administrators.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000215',
    'tenant.membership.owner.promote',
    'tenant',
    'Promote an active tenant administrator to owner.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000216',
    'tenant.membership.owner.demote',
    'tenant',
    'Demote a tenant owner while preserving the final-owner invariant.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000217',
    'tenant.security.session.read',
    'tenant',
    'Read tenant security sessions.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000218',
    'tenant.security.session.revoke',
    'tenant',
    'Revoke tenant security sessions.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO UPDATE SET
  "scope_level" = EXCLUDED."scope_level",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
CROSS JOIN "permissions" AS permission_row
WHERE role_row."key" = 'tenant_owner'
  AND permission_row."key" IN (
    'tenant.membership.read',
    'tenant.membership.admin.invite',
    'tenant.membership.admin.suspend',
    'tenant.membership.admin.revoke',
    'tenant.membership.owner.promote',
    'tenant.membership.owner.demote',
    'tenant.security.session.read',
    'tenant.security.session.revoke'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "roles" AS role_row
CROSS JOIN "permissions" AS permission_row
WHERE role_row."key" = 'tenant_admin'
  AND permission_row."key" IN (
    'tenant.membership.read',
    'tenant.membership.admin.invite',
    'tenant.membership.admin.suspend',
    'tenant.membership.admin.revoke',
    'tenant.security.session.read',
    'tenant.security.session.revoke'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_memberships" FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "tenant_memberships" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "tenant_memberships" FROM booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_memberships" TO booking_app;
CREATE POLICY "tenant_memberships_tenant_isolation"
  ON "tenant_memberships"
  FOR ALL
  TO booking_app
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

ALTER TABLE "membership_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_invitations" FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "membership_invitations" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "membership_invitations" FROM booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "membership_invitations" TO booking_app;
CREATE POLICY "membership_invitations_tenant_isolation"
  ON "membership_invitations"
  FOR ALL
  TO booking_app
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

ALTER TABLE "role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_assignments" FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "role_assignments" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "role_assignments" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "role_assignments" FROM booking_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "role_assignments" TO booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "role_assignments" TO booking_platform_app;
CREATE POLICY "role_assignments_tenant_isolation"
  ON "role_assignments"
  FOR ALL
  TO booking_app
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
CREATE POLICY "role_assignments_platform_scope"
  ON "role_assignments"
  FOR ALL
  TO booking_platform_app
  USING (
    "scope_level" = 'platform' AND "tenant_id" IS NULL
  )
  WITH CHECK (
    "scope_level" = 'platform' AND "tenant_id" IS NULL
  );

REVOKE ALL PRIVILEGES ON TABLE "tenant_domains" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "tenant_domains" FROM booking_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_domains" TO booking_platform_app;

CREATE OR REPLACE FUNCTION "assert_active_tenant_has_owner"(checked_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  checked_status public.tenant_status;
BEGIN
  IF checked_tenant_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(checked_tenant_id::text, 0));

  SELECT tenant_row."status"
    INTO checked_status
    FROM public."tenants" AS tenant_row
   WHERE tenant_row."id" = checked_tenant_id;

  IF checked_status = 'active'
     AND NOT EXISTS (
       SELECT 1
         FROM public."role_assignments" AS assignment
         INNER JOIN public."roles" AS role_row
           ON role_row."id" = assignment."role_id"
         INNER JOIN public."tenant_memberships" AS membership
           ON membership."tenant_id" = assignment."tenant_id"
          AND membership."user_id" = assignment."user_id"
        WHERE assignment."tenant_id" = checked_tenant_id
          AND assignment."scope_level" = 'tenant'
          AND assignment."revoked_at" IS NULL
          AND role_row."key" = 'tenant_owner'
          AND role_row."scope_level" = 'tenant'
          AND membership."status" = 'active'
     ) THEN
    RAISE EXCEPTION 'active tenant % must retain at least one active owner', checked_tenant_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_final_tenant_owner"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_tenant_id UUID;
  current_tenant_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    IF TG_OP <> 'INSERT' THEN
      previous_tenant_id := OLD."id";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      current_tenant_id := NEW."id";
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      previous_tenant_id := OLD."tenant_id";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      current_tenant_id := NEW."tenant_id";
    END IF;
  END IF;

  PERFORM public."assert_active_tenant_has_owner"(previous_tenant_id);
  IF current_tenant_id IS DISTINCT FROM previous_tenant_id THEN
    PERFORM public."assert_active_tenant_has_owner"(current_tenant_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "tenants_final_owner_invariant"
AFTER INSERT OR UPDATE OR DELETE ON "tenants"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_final_tenant_owner"();

CREATE CONSTRAINT TRIGGER "tenant_memberships_final_owner_invariant"
AFTER INSERT OR UPDATE OR DELETE ON "tenant_memberships"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_final_tenant_owner"();

CREATE CONSTRAINT TRIGGER "role_assignments_final_owner_invariant"
AFTER INSERT OR UPDATE OR DELETE ON "role_assignments"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_final_tenant_owner"();
