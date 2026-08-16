# Identity Access Recovery Runbook

This runbook covers Sprint 1B Platform/Tenant identity, opaque sessions, membership, authorization, and their operational dependencies.

## Safety rules

- Prefer read-only diagnosis, normal application/use-case paths, protected verification gates, and reviewed forward fixes.
- Never disable CSRF, Origin checks, host binding, authorization guards, FORCE RLS, final-owner enforcement, audit validation, token hashing, or session rotation to recover an incident.
- Never place secret values on the command line.
- Do not paste passwords, cookies, authorization headers, one-time links/fragments, refresh/session tokens, token peppers, envelope keys, SMTP credentials, or database credentials into tickets or logs.
- Do not repair user, membership, session, role-assignment, token, audit, or outbox state with ad-hoc write SQL.
- Record environment, deployment commit, effective host, request/trace ID when available, operator, incident time, and the recovery decision.

## Baseline verification

Before and after a recovery, run the applicable protected gates from the reviewed revision:

```bash
pnpm genesis:validate
pnpm check:ci
pnpm verify:architecture
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
pnpm verify:identity-access
pnpm verify:foundation
pnpm api:check-generated
pnpm build
pnpm test:e2e
```

A failed security/RLS/migration gate blocks rollout. Do not waive it by broadening privileges or relaxing browser/session policy.

## Lost device or suspected session compromise

1. Identify the affected user and scope without collecting raw cookie/token material.
2. Use the normal session listing/revocation flow for the current user, or the permission-gated Platform incident revocation path when an authorized Platform operator must revoke another user's sessions.
3. If compromise is broader than one session, revoke the affected session family/all user sessions through the approved application path.
4. Require normal re-authentication. If credentials may be compromised, complete the password-reset flow; successful reset revokes existing sessions according to the identity policy.
5. Correlate the resulting security-audit events by request ID, subject, event type, and time.

Do not restore a revoked session by editing session/token rows.

## Refresh reuse detection

Refresh reuse is treated as evidence that superseded material may have been copied. The session flow revokes the affected family rather than accepting a second rotation.

1. Preserve request/trace IDs and the affected session/user identifiers.
2. Confirm the reuse/revocation audit trail and that subsequent material from the family is rejected.
3. Ask the user to authenticate again on the correct host.
4. If repeated reuse continues after fresh authentication, treat it as a client/device compromise and follow the lost-device procedure.

## Password-reset recovery

- Use the normal neutral password-reset request endpoint; do not reveal whether an email is registered.
- One-time reset material remains single-use, purpose/host/user bound and short-lived.
- A successful password reset invalidates prior active reset material and revokes the required session state transactionally.
- If email delivery is delayed, restore the SMTP/outbox path instead of extracting a raw reset token from persistence or logs.

## User or membership suspension

Tenant membership suspension/revocation must use the approved membership management path under the tenant grant/resource policy. The mutation increments authorization state, writes audit in the tenant transaction, and revokes affected tenant sessions. Platform/global user status recovery must likewise go through an explicit reviewed application/administrative path; do not bypass authority by editing the user row.

After suspension/revocation, verify that a stale session cannot execute protected tenant logic and that `/auth/me/authorization` does not return stale tenant authority.

## SMTP outage

1. Verify API/worker readiness and inspect sanitized worker logs.
2. Restore SMTP/network/credential configuration through the deployment secret mechanism.
3. Keep activation/invitation/reset issuance state intact; queued encrypted outbox events remain the delivery source.
4. Resume the worker and confirm the backlog drains.
5. If a one-time token expires before delivery, use the normal resend/reset request flow to issue a replacement; do not decrypt or manually distribute a stored envelope.

## Redis outage

Redis is an operational dependency for queue/cache paths but does not become authorization truth.

1. Check readiness and Redis service state.
2. Restore connectivity/configuration and restart only the affected process when required.
3. Do not disable host binding, CSRF, session validation, PostgreSQL RLS, or authorization reconciliation to keep traffic flowing.
4. Confirm readiness recovers and rerun `pnpm verify:identity-access` against the recovery environment where appropriate.

## Identity envelope key rotation

Identity encrypted outbox payloads use a keyring plus an active key ID.

1. Add the new key to the deployment keyring through the secret-management path while retaining keys still needed to decrypt queued envelopes.
2. Deploy with the expanded keyring and verify health/identity email integration.
3. Switch the active envelope key ID to the new key in a separate reviewed configuration change.
4. Confirm newly produced envelopes use the new active key and existing queued envelopes can still be processed.
5. Retire an old key only after operational evidence shows no retained/queued envelope requires it and the rollback window is closed.

Do not rewrite historical encrypted payloads or place key material in migration files, command history, tickets, or audit metadata.

## Final-owner recovery

An active tenant must retain at least one active owner. Application locking plus a commit-time database invariant reject the last-owner suspend/revoke/demotion race.

- If an owner is still active, promote an eligible active administrator to owner through the normal owner-management path before changing the existing owner.
- If an operation returns the final-owner error, stop and establish a safe replacement owner; do not disable the invariant.
- If an exceptional incident leaves no usable human owner while database state still satisfies the invariant, use a reviewed break-glass recovery procedure owned by the accountable owner and implemented through an explicit forward application/migration change. Preserve the audit trail and require follow-up review.
- Never directly delete/demote the final owner or turn off the deferred database protection.

## Audit queries

Tenant security audit is FORCE-RLS protected. Query it only within an explicitly established tenant database context/approved operational tool. Prefer bounded columns and avoid dumping `metadata`.

```sql
SELECT event_type, actor_user_id, subject_user_id, request_id, occurred_at
FROM tenant_security_audit_events
WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
ORDER BY occurred_at DESC
LIMIT 200;
```

For a known request ID:

```sql
SELECT event_type, actor_user_id, subject_user_id, request_id, occurred_at
FROM tenant_security_audit_events
WHERE request_id = $1
ORDER BY occurred_at ASC;
```

Use parameterized/read-only tooling. Do not copy the complete audit metadata object into incident notes unless a reviewed investigation requires a specific bounded field.

## Phased additive rollout

1. Apply additive schema/RLS/index changes and deterministic catalogs first.
2. Run migration/policy verification before enabling the new application revision.
3. Deploy API/workers/web units from the same reviewed commit.
4. Enable new identity flows for the intended scope only after health, readiness, protected gates, and browser acceptance pass.
5. Observe security audit, bounded metrics, outbox health, session failure rates, and support signals before expanding traffic.

## Rollback

- Application rollback is allowed only to a revision compatible with the already-applied additive schema.
- Do not reverse an applied migration by editing migration history or dropping security constraints to match old code.
- If database behavior requires correction, ship a reviewed forward-fix migration and rerun migration/RLS/identity-access gates.
- Keep old envelope keys through the rollback window when queued payloads may still depend on them.
- A rollback does not justify re-enabling bootstrap, restoring revoked sessions, or bypassing final-owner/authorization policy.

Recovery is complete only when the incident condition is resolved, audit evidence is preserved, the affected user/scope behaves correctly on the trusted host, and the relevant protected gates are green.
