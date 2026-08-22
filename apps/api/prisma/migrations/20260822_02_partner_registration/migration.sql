-- Sprint 3.2 Partner registration challenge persistence.
-- Registration remains tenant-scoped and stores only a token digest, never serialized token material.

CREATE TABLE "partner_registration_challenges" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "normalized_email" text NOT NULL,
  "display_email" text NOT NULL,
  "partner_type" partner_type NOT NULL,
  "hostname" text NOT NULL,
  "selector" text NOT NULL,
  "token_hash" char(64) NOT NULL,
  "expires_at" timestamptz(6) NOT NULL,
  "consumed_at" timestamptz(6),
  "revoked_at" timestamptz(6),
  "completed_partner_id" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_registration_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_registration_challenges_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_registration_challenges_completed_partner_tenant_fkey"
    FOREIGN KEY ("completed_partner_id", "tenant_id")
    REFERENCES "partners"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_registration_challenges_completion_shape_check"
    CHECK ("completed_partner_id" IS NULL OR "consumed_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "partner_registration_challenges_tenant_id_normalized_email_key"
  ON "partner_registration_challenges" ("tenant_id", "normalized_email");
CREATE UNIQUE INDEX "partner_registration_challenges_selector_key"
  ON "partner_registration_challenges" ("selector");
CREATE INDEX "partner_registration_challenges_expires_at_idx"
  ON "partner_registration_challenges" ("expires_at");

ALTER TABLE "partner_registration_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_registration_challenges" FORCE ROW LEVEL SECURITY;

CREATE POLICY "partner_registration_challenges_tenant_isolation"
ON "partner_registration_challenges"
FOR ALL TO booking_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL PRIVILEGES ON TABLE "partner_registration_challenges" FROM booking_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "partner_registration_challenges" TO booking_app;
