-- Keep the code-owned Permission Catalog V2 complete when a database is built
-- from migrations alone. Prisma seed is for local/demo data and must not be
-- required for authorization correctness in CI or production deployments.
INSERT INTO "permissions" (
  "id",
  "key",
  "scope_level",
  "description",
  "created_at",
  "updated_at"
)
VALUES (
  '00000000-0000-4000-8000-000000000204',
  'platform.security.session.revoke',
  'platform',
  'Revoke all sessions for a user during a platform security incident.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "scope_level" = EXCLUDED."scope_level",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT
  role_row."id",
  permission_row."id",
  CURRENT_TIMESTAMP
FROM "roles" AS role_row
CROSS JOIN "permissions" AS permission_row
WHERE role_row."key" = 'platform_admin'
  AND role_row."scope_level" = 'platform'
  AND role_row."is_system" = TRUE
  AND permission_row."key" = 'platform.security.session.revoke'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
