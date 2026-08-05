CREATE TYPE "auth_session_state" AS ENUM (
  'active',
  'invitation_pending',
  'compromised',
  'revoked'
);

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "scope_type" "identity_scope_type" NOT NULL,
  "tenant_id" UUID,
  "hostname" TEXT NOT NULL,
  "state" "auth_session_state" NOT NULL DEFAULT 'active',
  "authorization_version" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),
  "revocation_reason" TEXT,
  "compromised_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auth_sessions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auth_sessions_scope_check" CHECK (
    ("scope_type" = 'platform' AND "tenant_id" IS NULL)
    OR
    ("scope_type" = 'tenant' AND "tenant_id" IS NOT NULL)
  ),
  CONSTRAINT "auth_sessions_invitation_state_check" CHECK (
    "state" <> 'invitation_pending'
    OR "scope_type" = 'tenant'
  ),
  CONSTRAINT "auth_sessions_version_check" CHECK (
    "authorization_version" > 0 AND "version" > 0
  ),
  CONSTRAINT "auth_sessions_hostname_check" CHECK (
    length("hostname") BETWEEN 1 AND 253
    AND "hostname" = lower("hostname")
    AND "hostname" !~ '[[:space:]/]'
  ),
  CONSTRAINT "auth_sessions_expiry_check" CHECK (
    "created_at" <= "last_seen_at"
    AND "last_seen_at" <= "idle_expires_at"
    AND "idle_expires_at" <= "absolute_expires_at"
  ),
  CONSTRAINT "auth_sessions_state_check" CHECK (
    ("state" IN ('active', 'invitation_pending')
      AND "revoked_at" IS NULL
      AND "compromised_at" IS NULL)
    OR
    ("state" = 'compromised'
      AND "revoked_at" IS NOT NULL
      AND "compromised_at" IS NOT NULL)
    OR
    ("state" = 'revoked'
      AND "revoked_at" IS NOT NULL
      AND "compromised_at" IS NULL)
  ),
  CONSTRAINT "auth_sessions_revocation_reason_check" CHECK (
    "revocation_reason" IS NULL OR "revoked_at" IS NOT NULL
  )
);

CREATE TABLE "auth_session_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "scope_type" "identity_scope_type" NOT NULL,
  "tenant_id" UUID,
  "selector" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "replaced_at" TIMESTAMPTZ(6),
  "overlap_until" TIMESTAMPTZ(6),
  "successor_token_id" UUID,
  "reuse_detected_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "auth_session_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_session_tokens_selector_key" UNIQUE ("selector"),
  CONSTRAINT "auth_session_tokens_successor_token_id_key" UNIQUE ("successor_token_id"),
  CONSTRAINT "auth_session_tokens_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auth_session_tokens_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auth_session_tokens_successor_token_id_fkey"
    FOREIGN KEY ("successor_token_id") REFERENCES "auth_session_tokens"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "auth_session_tokens_scope_check" CHECK (
    ("scope_type" = 'platform' AND "tenant_id" IS NULL)
    OR
    ("scope_type" = 'tenant' AND "tenant_id" IS NOT NULL)
  ),
  CONSTRAINT "auth_session_tokens_selector_check" CHECK (
    length("selector") BETWEEN 16 AND 255
  ),
  CONSTRAINT "auth_session_tokens_hash_check" CHECK (
    "token_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "auth_session_tokens_expiry_check" CHECK (
    "issued_at" < "expires_at"
  ),
  CONSTRAINT "auth_session_tokens_replacement_check" CHECK (
    ("replaced_at" IS NULL AND "overlap_until" IS NULL AND "successor_token_id" IS NULL)
    OR
    ("replaced_at" IS NOT NULL
      AND "overlap_until" IS NOT NULL
      AND "replaced_at" <= "overlap_until")
  ),
  CONSTRAINT "auth_session_tokens_reuse_check" CHECK (
    "reuse_detected_at" IS NULL OR "replaced_at" IS NOT NULL
  ),
  CONSTRAINT "auth_session_tokens_no_self_successor_check" CHECK (
    "successor_token_id" IS NULL OR "successor_token_id" <> "id"
  )
);

CREATE INDEX "auth_sessions_user_id_idx"
  ON "auth_sessions"("user_id");
CREATE INDEX "auth_sessions_tenant_id_idx"
  ON "auth_sessions"("tenant_id");
CREATE INDEX "auth_sessions_hostname_state_idx"
  ON "auth_sessions"("hostname", "state");
CREATE INDEX "auth_sessions_idle_expires_at_absolute_expires_at_idx"
  ON "auth_sessions"("idle_expires_at", "absolute_expires_at");

CREATE INDEX "auth_session_tokens_session_id_idx"
  ON "auth_session_tokens"("session_id");
CREATE INDEX "auth_session_tokens_tenant_id_idx"
  ON "auth_session_tokens"("tenant_id");
CREATE INDEX "auth_session_tokens_expires_at_idx"
  ON "auth_session_tokens"("expires_at");
CREATE UNIQUE INDEX "auth_session_tokens_one_active_family_key"
  ON "auth_session_tokens"("session_id")
  WHERE "replaced_at" IS NULL AND "revoked_at" IS NULL;

CREATE FUNCTION "enforce_auth_session_token_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_scope "identity_scope_type";
  parent_tenant UUID;
BEGIN
  SELECT "scope_type", "tenant_id"
  INTO parent_scope, parent_tenant
  FROM "auth_sessions"
  WHERE "id" = NEW."session_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session family is unavailable for token scope validation'
      USING ERRCODE = '23503';
  END IF;

  IF parent_scope <> NEW."scope_type"
    OR parent_tenant IS DISTINCT FROM NEW."tenant_id" THEN
    RAISE EXCEPTION 'session token scope does not match its family'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "auth_session_tokens_scope_match_trigger"
BEFORE INSERT OR UPDATE OF "session_id", "scope_type", "tenant_id"
ON "auth_session_tokens"
FOR EACH ROW
EXECUTE FUNCTION "enforce_auth_session_token_scope"();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'booking_platform_app') THEN
    CREATE ROLE booking_platform_app
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END;
$$;

ALTER ROLE booking_platform_app
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

GRANT booking_platform_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO booking_platform_app;

REVOKE ALL ON TABLE "auth_sessions" FROM PUBLIC;
REVOKE ALL ON TABLE "auth_session_tokens" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "auth_sessions" TO booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "auth_session_tokens" TO booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "auth_sessions" TO booking_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "auth_session_tokens" TO booking_platform_app;

ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "auth_session_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_session_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY "auth_sessions_tenant_isolation"
ON "auth_sessions"
FOR ALL
TO booking_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "auth_sessions_platform_scope"
ON "auth_sessions"
FOR ALL
TO booking_platform_app
USING (
  "scope_type" = 'platform' AND "tenant_id" IS NULL
)
WITH CHECK (
  "scope_type" = 'platform' AND "tenant_id" IS NULL
);

CREATE POLICY "auth_session_tokens_tenant_isolation"
ON "auth_session_tokens"
FOR ALL
TO booking_app
USING (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

CREATE POLICY "auth_session_tokens_platform_scope"
ON "auth_session_tokens"
FOR ALL
TO booking_platform_app
USING (
  "scope_type" = 'platform' AND "tenant_id" IS NULL
)
WITH CHECK (
  "scope_type" = 'platform' AND "tenant_id" IS NULL
);
