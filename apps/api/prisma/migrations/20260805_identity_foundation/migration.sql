CREATE TYPE "user_status" AS ENUM (
  'pending_activation',
  'active',
  'suspended',
  'disabled'
);

CREATE TYPE "identity_scope_type" AS ENUM ('platform', 'tenant');
CREATE TYPE "role_scope_level" AS ENUM ('platform', 'tenant');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "normalized_email" TEXT NOT NULL,
  "display_email" TEXT NOT NULL,
  "status" "user_status" NOT NULL DEFAULT 'pending_activation',
  "authorization_version" INTEGER NOT NULL DEFAULT 1,
  "activated_at" TIMESTAMPTZ(6),
  "suspended_at" TIMESTAMPTZ(6),
  "disabled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_normalized_email_check" CHECK (
    "normalized_email" = lower(btrim("normalized_email"))
    AND length("normalized_email") > 0
  ),
  CONSTRAINT "users_display_email_check" CHECK (length(btrim("display_email")) > 0),
  CONSTRAINT "users_authorization_version_check" CHECK ("authorization_version" > 0)
);

CREATE UNIQUE INDEX "users_normalized_email_key" ON "users" ("normalized_email");
CREATE INDEX "users_status_idx" ON "users" ("status");

CREATE TABLE "password_credentials" (
  "user_id" UUID NOT NULL,
  "password_hash" TEXT NOT NULL,
  "algorithm" VARCHAR(32) NOT NULL DEFAULT 'argon2id',
  "parameters" JSONB NOT NULL,
  "password_changed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "password_credentials_algorithm_check" CHECK ("algorithm" = 'argon2id'),
  CONSTRAINT "password_credentials_hash_check" CHECK (length("password_hash") > 0),
  CONSTRAINT "password_credentials_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "scope_level" "role_scope_level" NOT NULL,
  "is_system" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "roles_key_check" CHECK (length(btrim("key")) > 0)
);

CREATE UNIQUE INDEX "roles_key_key" ON "roles" ("key");

CREATE TABLE "permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "scope_level" "role_scope_level" NOT NULL,
  "description" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "permissions_key_check" CHECK (length(btrim("key")) > 0),
  CONSTRAINT "permissions_description_check" CHECK (length(btrim("description")) > 0)
);

CREATE UNIQUE INDEX "permissions_key_key" ON "permissions" ("key");

CREATE TABLE "role_permissions" (
  "role_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id"),
  CONSTRAINT "role_permissions_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "role_permissions_permission_id_fkey"
    FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "role_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "scope_level" "role_scope_level" NOT NULL,
  "tenant_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),

  CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "role_assignments_platform_scope_check" CHECK (
    "scope_level" = 'platform' AND "tenant_id" IS NULL
  ),
  CONSTRAINT "role_assignments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "role_assignments_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "role_assignments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "role_assignments_user_id_idx" ON "role_assignments" ("user_id");
CREATE INDEX "role_assignments_role_id_idx" ON "role_assignments" ("role_id");
CREATE INDEX "role_assignments_tenant_id_idx" ON "role_assignments" ("tenant_id");
CREATE UNIQUE INDEX "role_assignments_one_active_scope_key"
  ON "role_assignments" ("user_id", "role_id", "scope_level", "tenant_id") NULLS NOT DISTINCT
  WHERE "revoked_at" IS NULL;

CREATE TABLE "account_activation_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "scope_type" "identity_scope_type" NOT NULL,
  "tenant_id" UUID,
  "invitation_id" UUID,
  "hostname" TEXT NOT NULL,
  "selector" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "account_activation_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_activation_tokens_scope_check" CHECK (
    (
      "scope_type" = 'platform'
      AND "tenant_id" IS NULL
      AND "invitation_id" IS NULL
    )
    OR
    (
      "scope_type" = 'tenant'
      AND "tenant_id" IS NOT NULL
      AND "invitation_id" IS NOT NULL
    )
  ),
  CONSTRAINT "account_activation_tokens_lifecycle_check" CHECK (
    "consumed_at" IS NULL OR "revoked_at" IS NULL
  ),
  CONSTRAINT "account_activation_tokens_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "account_activation_tokens_hostname_check" CHECK (
    "hostname" = lower(btrim("hostname")) AND length("hostname") > 0
  ),
  CONSTRAINT "account_activation_tokens_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "account_activation_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "account_activation_tokens_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "account_activation_tokens_selector_key"
  ON "account_activation_tokens" ("selector");
CREATE INDEX "account_activation_tokens_user_id_idx"
  ON "account_activation_tokens" ("user_id");
CREATE INDEX "account_activation_tokens_tenant_id_idx"
  ON "account_activation_tokens" ("tenant_id");
CREATE INDEX "account_activation_tokens_expires_at_idx"
  ON "account_activation_tokens" ("expires_at");
CREATE UNIQUE INDEX "account_activation_tokens_one_active_scope_key"
  ON "account_activation_tokens" ("user_id", "scope_type", "tenant_id", "hostname")
  NULLS NOT DISTINCT
  WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;

CREATE TABLE "password_reset_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "scope_type" "identity_scope_type" NOT NULL,
  "tenant_id" UUID,
  "hostname" TEXT NOT NULL,
  "selector" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_reset_tokens_scope_check" CHECK (
    ("scope_type" = 'platform' AND "tenant_id" IS NULL)
    OR ("scope_type" = 'tenant' AND "tenant_id" IS NOT NULL)
  ),
  CONSTRAINT "password_reset_tokens_lifecycle_check" CHECK (
    "consumed_at" IS NULL OR "revoked_at" IS NULL
  ),
  CONSTRAINT "password_reset_tokens_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "password_reset_tokens_hostname_check" CHECK (
    "hostname" = lower(btrim("hostname")) AND length("hostname") > 0
  ),
  CONSTRAINT "password_reset_tokens_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "password_reset_tokens_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "password_reset_tokens_selector_key"
  ON "password_reset_tokens" ("selector");
CREATE INDEX "password_reset_tokens_user_id_idx"
  ON "password_reset_tokens" ("user_id");
CREATE INDEX "password_reset_tokens_tenant_id_idx"
  ON "password_reset_tokens" ("tenant_id");
CREATE INDEX "password_reset_tokens_expires_at_idx"
  ON "password_reset_tokens" ("expires_at");
CREATE UNIQUE INDEX "password_reset_tokens_one_active_scope_key"
  ON "password_reset_tokens" ("user_id", "scope_type", "tenant_id", "hostname")
  NULLS NOT DISTINCT
  WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;

CREATE TABLE "security_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_type" TEXT NOT NULL,
  "actor_user_id" UUID,
  "subject_user_id" UUID,
  "request_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "security_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_audit_events_type_check" CHECK (length(btrim("event_type")) > 0),
  CONSTRAINT "security_audit_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "security_audit_events_subject_user_id_fkey"
    FOREIGN KEY ("subject_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "security_audit_events_event_type_occurred_at_idx"
  ON "security_audit_events" ("event_type", "occurred_at");
CREATE INDEX "security_audit_events_actor_user_id_idx"
  ON "security_audit_events" ("actor_user_id");
CREATE INDEX "security_audit_events_subject_user_id_idx"
  ON "security_audit_events" ("subject_user_id");

INSERT INTO "roles" (
  "id",
  "key",
  "scope_level",
  "is_system",
  "created_at",
  "updated_at"
)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  'platform_admin',
  'platform',
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
    '00000000-0000-4000-8000-000000000201',
    'platform.security.audit.read',
    'platform',
    'Read platform security audit events.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    'platform.tenants.provision',
    'platform',
    'Provision a tenant and its initial owner invitation.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    'platform.users.provision',
    'platform',
    'Provision global user accounts.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO UPDATE SET
  "scope_level" = EXCLUDED."scope_level",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT
  role_row."id",
  permission_row."id",
  CURRENT_TIMESTAMP
FROM "roles" AS role_row
CROSS JOIN "permissions" AS permission_row
WHERE role_row."key" = 'platform_admin'
  AND permission_row."key" IN (
    'platform.security.audit.read',
    'platform.tenants.provision',
    'platform.users.provision'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
