-- PostgreSQL requires newly-added enum values to commit before later migrations use them.
-- Keep this expand-only migration separate from Partner authority persistence.

ALTER TYPE identity_scope_type ADD VALUE IF NOT EXISTS 'partner';
ALTER TYPE role_scope_level ADD VALUE IF NOT EXISTS 'partner';
