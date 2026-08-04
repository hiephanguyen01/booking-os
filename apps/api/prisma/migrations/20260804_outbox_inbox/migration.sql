CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "tenant_id" UUID,
  "type" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatched_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "first_failed_at" TIMESTAMPTZ,
  "last_failed_at" TIMESTAMPTZ,
  "dead_lettered_at" TIMESTAMPTZ,
  "claimed_at" TIMESTAMPTZ,
  "claim_token" UUID,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "outbox_events_available_at_dispatched_at_dead_lettered_at_idx"
  ON "outbox_events"("available_at", "dispatched_at", "dead_lettered_at");
CREATE INDEX "outbox_events_tenant_id_idx" ON "outbox_events"("tenant_id");

CREATE TABLE "inbox_messages" (
  "id" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ,
  CONSTRAINT "inbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inbox_messages_source_external_id_key"
  ON "inbox_messages"("source", "external_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'booking_worker') THEN
    CREATE ROLE booking_worker
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      BYPASSRLS;
  END IF;
END
$$;

GRANT booking_worker TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO booking_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox_events" TO booking_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON "inbox_messages" TO booking_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox_events" TO booking_app;

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "outbox_event_tenant_isolation" ON "outbox_events"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
