-- Expand persisted authorization scope enums before any migration uses the Partner value.
-- PostgreSQL requires newly added enum values to commit before they are referenced.

ALTER TYPE "identity_scope_type" ADD VALUE IF NOT EXISTS 'partner';
ALTER TYPE "role_scope_level" ADD VALUE IF NOT EXISTS 'partner';
