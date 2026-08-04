CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "tenants" (
  "id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

CREATE TABLE "tenant_probes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "value" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_probes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_probes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "tenant_probes_tenant_id_idx" ON "tenant_probes"("tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'booking_app') THEN
    CREATE ROLE booking_app
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END
$$;

GRANT booking_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO booking_app;
GRANT SELECT ON "tenants" TO booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_probes" TO booking_app;

ALTER TABLE "tenant_probes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_probes" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_probe_isolation" ON "tenant_probes"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
