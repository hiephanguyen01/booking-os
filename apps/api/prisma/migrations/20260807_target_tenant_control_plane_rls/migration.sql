-- Task 4: platform tenant provisioning must authorize globally, then perform
-- writes through one explicit target-tenant transaction using booking_app.
-- Keep global orchestration state (tenant_provisioning_requests) untouched.

-- `tenants` has no tenant_id column, so scope booking_app by the row id that
-- matches app.tenant_id. Do not FORCE RLS here: migration/admin owners retain
-- their normal owner semantics, while booking_app remains constrained by RLS.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "tenants" FROM booking_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "tenants" TO booking_app;

REVOKE ALL PRIVILEGES ON TABLE "tenants" FROM booking_platform_app;
GRANT SELECT ON TABLE "tenants" TO booking_platform_app;

DROP POLICY IF EXISTS "tenants_target_tenant_access" ON "tenants";
CREATE POLICY "tenants_target_tenant_access"
  ON "tenants"
  FOR ALL
  TO booking_app
  USING (
    "id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

DROP POLICY IF EXISTS "tenants_platform_read" ON "tenants";
CREATE POLICY "tenants_platform_read"
  ON "tenants"
  FOR SELECT
  TO booking_platform_app
  USING (TRUE);

-- tenant_domains is tenant data: enforce FORCE RLS so cross-tenant writes are
-- denied even if repository code forgets a tenant predicate.
ALTER TABLE "tenant_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "tenant_domains" FROM booking_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_domains" TO booking_app;

-- Global platform code may resolve/check hostnames, but writes belong in the
-- target-tenant transaction above. Restrict the platform role to read-only.
REVOKE ALL PRIVILEGES ON TABLE "tenant_domains" FROM booking_platform_app;
GRANT SELECT ON TABLE "tenant_domains" TO booking_platform_app;

DROP POLICY IF EXISTS "tenant_domains_target_tenant_access" ON "tenant_domains";
CREATE POLICY "tenant_domains_target_tenant_access"
  ON "tenant_domains"
  FOR ALL
  TO booking_app
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

DROP POLICY IF EXISTS "tenant_domains_platform_read" ON "tenant_domains";
CREATE POLICY "tenant_domains_platform_read"
  ON "tenant_domains"
  FOR SELECT
  TO booking_platform_app
  USING (TRUE);

-- Intentionally no grants/policies for tenant_provisioning_requests here.
-- It remains global orchestration state and must not be directly writable by
-- booking_app.
