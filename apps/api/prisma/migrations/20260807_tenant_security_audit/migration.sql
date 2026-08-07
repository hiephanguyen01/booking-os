CREATE TABLE "tenant_security_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_user_id" UUID,
  "subject_user_id" UUID,
  "request_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_security_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_security_audit_events_event_type_check"
    CHECK (length(btrim("event_type")) > 0),
  CONSTRAINT "tenant_security_audit_events_metadata_check"
    CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "tenant_security_audit_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_security_audit_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "tenant_security_audit_events_subject_user_id_fkey"
    FOREIGN KEY ("subject_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "tenant_security_audit_events_tenant_id_idx"
  ON "tenant_security_audit_events"("tenant_id");
CREATE INDEX "tenant_security_audit_events_event_type_occurred_at_idx"
  ON "tenant_security_audit_events"("event_type", "occurred_at");
CREATE INDEX "tenant_security_audit_events_actor_user_id_idx"
  ON "tenant_security_audit_events"("actor_user_id");
CREATE INDEX "tenant_security_audit_events_subject_user_id_idx"
  ON "tenant_security_audit_events"("subject_user_id");

ALTER TABLE "tenant_security_audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_security_audit_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_security_audit_events_tenant_isolation"
  ON "tenant_security_audit_events"
  FOR ALL
  TO booking_app
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

REVOKE ALL PRIVILEGES ON TABLE "tenant_security_audit_events" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "tenant_security_audit_events" FROM booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE "tenant_security_audit_events"
  TO booking_app;
