# Tenant Dynamic RBAC Recovery

## Purpose

Use this runbook when tenant custom-role authority is assigned incorrectly, expanded incorrectly, archived unexpectedly, appears stale in an active session, or RBAC mutation traffic must be stopped while read authorization remains available. Recovery stays inside the implemented Tenant RBAC API, tenant authorization boundary, and normal deployment process. Do not repair authority by direct production table edits.

The Authorization domain owner in `docs/ownership/DOMAIN-OWNERS.md` owns technical escalation for this slice. Preserve request IDs, role IDs, membership IDs, timestamps, and audit-event identifiers needed for investigation, but never copy raw cookies, CSRF tokens, credentials, or other secret material into tickets or command history.

Never place secret values on the command line.

## Verification baseline

Before and after a reviewed recovery, run the dedicated acceptance gate in an isolated/test environment:

```bash
pnpm verify:dynamic-rbac
```

For repository closeout or a code-level forward fix, also run the existing protected verification appropriate to the change, including `pnpm verify:identity-access`, `pnpm verify:migrations`, `pnpm verify:architecture`, and `pnpm verify:foundation`.

## Accidental role assignment

1. Confirm the request is for the expected tenant host and identify the affected active membership and custom role from trusted operator context.
2. Read the membership's assigned custom roles with `GET /api/tenant/rbac/memberships/:membershipId/roles` and record the request ID/audit context without copying session secrets.
3. Revoke only the incorrect assignment with `DELETE /api/tenant/rbac/memberships/:membershipId/roles/:roleId` using the normal authenticated owner session, same-origin, and CSRF protections.
4. Re-read the membership roles and `/api/auth/me/authorization` for an affected interactive subject as applicable. A real revoke increments the membership authorization version; stale authority must be reconciled before protected application logic can continue.
5. Review `tenant.rbac.assignment.revoked` audit evidence. A duplicate revoke is a safe no-op and must not be treated as another authority change.

Do not delete assignment history directly from PostgreSQL and do not bypass tenant scope to accelerate cleanup.

## Accidental permission expansion

1. Read the affected custom role with `GET /api/tenant/rbac/roles/:roleId` and capture its current version.
2. Build the intended complete permission set using only Permission Catalog V2 keys the owner is allowed to delegate.
3. Replace the role permissions through `PUT /api/tenant/rbac/roles/:roleId/permissions` with the current `expectedVersion`. Do not patch database mapping rows manually.
4. If the request returns a version conflict, stop, re-read the role, re-evaluate the desired set, and retry with the new version rather than overwriting concurrent work.
5. Verify the reduced permission set and affected membership authorization. A real permission change invalidates active holders' authorization versions; an identical desired set is a no-op.
6. Review the corresponding role-permission audit event and investigate how the expansion was authorized.

Unknown, platform-only, non-delegable, or actor-not-held additions are expected to fail atomically; do not work around that guard.

## Archived role impact

1. Read the role and affected memberships to distinguish an intended archive from an availability or stale-client issue.
2. Treat archive as an authority-removal operation: active assignments are revoked and the archived role must no longer contribute effective permissions.
3. Confirm affected subjects are denied stale authority after authorization-version reconciliation and verify archive/revocation audit evidence.
4. Do not restore authority by editing `archived_at`, assignment rows, or role versions directly. There is no privileged unarchive recovery endpoint in this Sprint 2 slice.
5. If business authority must be restored, use only the currently implemented reviewed Tenant RBAC APIs and normal owner-governed workflow; preserve the archived role and its audit history.

## Stale authority and session reconciliation

1. Re-read current membership/custom-role state and confirm the expected authority-changing mutation committed.
2. Use `/api/auth/me/authorization` from the correct tenant host to observe current-scope authorization for the interactive subject. Custom roles must not appear in system `roleKeys`; only their active permissions may contribute to `permissionKeys`.
3. If a pre-mutation request/context is rejected, treat that as the intended stale-authority fence. Retry through the normal session flow so the server rebuilds/reconciles current authority before protected logic.
4. If stale permission authority still executes after a verified revoke, permission replacement, or archive, stop further RBAC mutations for the affected tenant and escalate as a security incident. Preserve request IDs and audit metadata, then reproduce through the dedicated PostgreSQL acceptance matrix before changing production code.
5. Never re-enable authority by lowering authorization-version checks or bypassing `PermissionGuard`/tenant transaction boundaries.

## RBAC mutation outage

If RBAC mutation behavior is unsafe or unavailable while existing read authorization is still healthy:

1. Stop or reject Tenant RBAC mutation traffic through a reviewed application deployment/routing change. Sprint 2 does not define a privileged operator endpoint or database switch for this purpose; do not invent one during an incident.
2. Keep RBAC tables, assignments, audit history, and read-side authorization intact so existing current authority can continue to be evaluated under the normal tenant/RLS boundary.
3. Do not drop RBAC tables, delete history, disable FORCE RLS, or remove authorization-version reconciliation as rollback actions.
4. Prefer a forward fix. If application rollback is necessary, roll back only to a schema-compatible revision that continues to understand the additive Sprint 2 schema and security invariants.
5. Re-enable mutations only after `pnpm verify:dynamic-rbac` and the relevant protected security/regression gates are green on the candidate revision.

## Escalation and evidence

Record the tenant-safe identifiers needed to correlate the incident, the attempted API operation, stable machine error code, request ID, expected/observed authorization version, and relevant audit event. Do not record raw headers, cookie values, CSRF tokens, passwords, reset/activation tokens, or email bodies.

A recovery is complete only when the intended current authority is observable, stale authority no longer reaches protected application logic, required audit evidence exists, and the repository verification appropriate to any code change is green.
