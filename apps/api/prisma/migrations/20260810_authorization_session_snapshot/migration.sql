ALTER TABLE "auth_sessions"
ADD COLUMN "membership_authorization_version" INTEGER;

-- Expand phase: old application instances may still create tenant sessions without
-- the membership snapshot while a rolling deployment is in progress. Backfill the
-- rows that have an unambiguous membership and leave unmatched historical rows NULL.
-- New code writes the snapshot and fails closed when an active tenant session has no
-- snapshot. A later contract migration may add the scope CHECK after all writers have
-- been upgraded and unmatched sessions have expired or been revoked.
UPDATE "auth_sessions" AS session
SET "membership_authorization_version" = membership."authorization_version"
FROM "tenant_memberships" AS membership
WHERE session."scope_type" = 'tenant'
  AND session."tenant_id" = membership."tenant_id"
  AND session."user_id" = membership."user_id";
