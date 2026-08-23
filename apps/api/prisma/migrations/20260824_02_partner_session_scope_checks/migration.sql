ALTER TABLE "auth_sessions"
  DROP CONSTRAINT "auth_sessions_scope_check";

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_scope_check" CHECK (
    ("scope_type" = 'platform'::identity_scope_type AND "tenant_id" IS NULL)
    OR
    ("scope_type" IN ('tenant'::identity_scope_type, 'partner'::identity_scope_type)
      AND "tenant_id" IS NOT NULL)
  );

ALTER TABLE "auth_session_tokens"
  DROP CONSTRAINT "auth_session_tokens_scope_check";

ALTER TABLE "auth_session_tokens"
  ADD CONSTRAINT "auth_session_tokens_scope_check" CHECK (
    ("scope_type" = 'platform'::identity_scope_type AND "tenant_id" IS NULL)
    OR
    ("scope_type" IN ('tenant'::identity_scope_type, 'partner'::identity_scope_type)
      AND "tenant_id" IS NOT NULL)
  );
