-- Tenant custom-role UUIDs are stable authorization-management identities.
-- booking_app still requires table-level UPDATE for metadata/archive operations, so guard the
-- identity column explicitly at the database boundary.

CREATE OR REPLACE FUNCTION prevent_tenant_custom_role_identity_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $role_identity$
BEGIN
  IF OLD."id" IS DISTINCT FROM NEW."id" THEN
    RAISE EXCEPTION 'tenant custom role identity cannot be modified' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$role_identity$;

CREATE TRIGGER "tenant_custom_roles_prevent_identity_update"
BEFORE UPDATE OF "id"
ON "tenant_custom_roles"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_custom_role_identity_update();

REVOKE ALL ON FUNCTION prevent_tenant_custom_role_identity_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prevent_tenant_custom_role_identity_update() TO booking_app;
