-- Sprint 3.2 verified Partner registration establishment.
-- Global identity mutation stays behind a narrow SECURITY DEFINER boundary while
-- Partner authority remains tenant-owned and FORCE-RLS protected.

ALTER TABLE "partner_registration_challenges"
  ADD CONSTRAINT "partner_registration_challenges_id_tenant_id_key"
  UNIQUE ("id", "tenant_id");

ALTER TABLE "partners"
  ADD COLUMN "registration_challenge_id" uuid;

CREATE UNIQUE INDEX "partners_registration_challenge_id_key"
  ON "partners" ("registration_challenge_id");

ALTER TABLE "partners"
  ADD CONSTRAINT "partners_registration_challenge_tenant_fkey"
  FOREIGN KEY ("registration_challenge_id", "tenant_id")
  REFERENCES "partner_registration_challenges" ("id", "tenant_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TRIGGER "partners_prevent_identity_update" ON "partners";
CREATE OR REPLACE FUNCTION prevent_partner_identity_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD."id" IS DISTINCT FROM NEW."id"
    OR OLD."tenant_id" IS DISTINCT FROM NEW."tenant_id"
    OR OLD."registration_challenge_id" IS DISTINCT FROM NEW."registration_challenge_id" THEN
    RAISE EXCEPTION 'Partner identity cannot be modified' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "partners_prevent_identity_update"
BEFORE UPDATE OF "id", "tenant_id", "registration_challenge_id"
ON "partners"
FOR EACH ROW EXECUTE FUNCTION prevent_partner_identity_update();

CREATE TABLE "partner_status_history" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "application_status" partner_application_status NOT NULL,
  "operational_status" partner_operational_status NOT NULL,
  "occurred_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_status_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_status_history_partner_tenant_fkey"
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "partner_status_history_tenant_id_idx"
  ON "partner_status_history" ("tenant_id");
CREATE INDEX "partner_status_history_partner_id_occurred_at_idx"
  ON "partner_status_history" ("partner_id", "occurred_at");

ALTER TABLE "partner_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_status_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY "partner_status_history_tenant_isolation"
ON "partner_status_history"
FOR ALL TO booking_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL PRIVILEGES ON TABLE "partner_status_history" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "partner_status_history" FROM booking_app;
GRANT SELECT, INSERT ON TABLE "partner_status_history" TO booking_app;

CREATE OR REPLACE FUNCTION "partner_registration_activate_or_create_identity"(
  p_normalized_email text,
  p_display_email text,
  p_password_hash text,
  p_parameters jsonb
)
RETURNS TABLE (user_id uuid, authorization_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  inserted_id uuid;
  inserted_version integer;
  existing_id uuid;
  existing_status public.user_status;
  existing_version integer;
BEGIN
  INSERT INTO public."users" (
    "id", "normalized_email", "display_email", "status", "authorization_version",
    "activated_at", "created_at", "updated_at"
  )
  VALUES (
    gen_random_uuid(), p_normalized_email, p_display_email, 'active'::public.user_status, 1,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("normalized_email") DO NOTHING
  RETURNING "id", "authorization_version"
  INTO inserted_id, inserted_version;

  IF inserted_id IS NOT NULL THEN
    INSERT INTO public."password_credentials" (
      "user_id", "password_hash", "algorithm", "parameters",
      "password_changed_at", "created_at", "updated_at"
    )
    VALUES (
      inserted_id, p_password_hash, 'argon2id', p_parameters,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
    RETURN QUERY SELECT inserted_id, inserted_version;
    RETURN;
  END IF;

  SELECT user_row."id", user_row."status", user_row."authorization_version"
  INTO existing_id, existing_status, existing_version
  FROM public."users" AS user_row
  WHERE user_row."normalized_email" = p_normalized_email
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner registration identity is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF existing_status = 'active'::public.user_status THEN
    RETURN QUERY SELECT existing_id, existing_version;
    RETURN;
  END IF;

  IF existing_status <> 'pending_activation'::public.user_status THEN
    RAISE EXCEPTION 'Partner registration identity is unavailable' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public."users"
  SET "status" = 'active'::public.user_status,
      "activated_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = existing_id
  RETURNING "authorization_version" INTO existing_version;

  INSERT INTO public."password_credentials" (
    "user_id", "password_hash", "algorithm", "parameters",
    "password_changed_at", "created_at", "updated_at"
  )
  VALUES (
    existing_id, p_password_hash, 'argon2id', p_parameters,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("user_id") DO UPDATE
  SET "password_hash" = EXCLUDED."password_hash",
      "algorithm" = EXCLUDED."algorithm",
      "parameters" = EXCLUDED."parameters",
      "password_changed_at" = EXCLUDED."password_changed_at",
      "updated_at" = EXCLUDED."updated_at";

  RETURN QUERY SELECT existing_id, existing_version;
END;
$$;

REVOKE ALL ON FUNCTION "partner_registration_activate_or_create_identity"(text, text, text, jsonb)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "partner_registration_activate_or_create_identity"(text, text, text, jsonb)
TO booking_app;
