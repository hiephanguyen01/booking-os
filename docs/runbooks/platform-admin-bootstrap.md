# Platform Administrator Bootstrap Runbook

This runbook provisions the first Booking OS Platform administrator only. It is an initialization/recovery procedure, not a general user-management path.

## Safety rules

- Run bootstrap from a reviewed deployment revision after database migrations and deterministic role/permission seeds are applied.
- Use the exact configured Platform hostname. Do not substitute a tenant hostname or a caller-provided tenant identifier.
- Configure the administrator email and cryptographic material through the deployment secret/environment mechanism before starting the command.
- Never place secret values on the command line.
- Never pass the administrator email, token pepper, envelope keyring, active envelope key, session secret, database credentials, or Redis credentials as CLI arguments.
- Do not edit role assignments, activation tokens, outbox rows, or security-audit rows manually to make bootstrap appear successful.
- After the first administrator is confirmed, disable bootstrap configuration and redeploy through the normal reviewed path.

## Preconditions

1. PostgreSQL is reachable and all committed migrations are applied.
2. The deterministic `platform_admin` role catalog exists.
3. Identity security configuration is valid: token pepper, envelope keyring, and active envelope key ID are supplied by the runtime environment.
4. `IDENTITY_BOOTSTRAP_ENABLED` is enabled for this controlled operation and `IDENTITY_BOOTSTRAP_ADMIN_EMAIL` is supplied by the runtime environment.
5. SMTP/outbox delivery is operational, or the operator has declared an SMTP incident and will restore delivery without inspecting/decrypting raw token material in logs.
6. The Platform hostname is known and matches the environment's host policy.

Run the non-destructive verification gates first:

```bash
pnpm genesis:validate
pnpm --filter @booking-os/api prisma:validate
pnpm verify:migrations
```

## Bootstrap command

For local HTTPS development, the reviewed command shape is:

```bash
pnpm --filter @booking-os/api identity:bootstrap-platform-admin -- --hostname platform.booking.localhost
```

For another environment, replace only the hostname argument with that environment's exact configured Platform hostname. Secret/configuration values remain in the runtime environment and are not appended to this command.

The command emits a small JSON result containing the user identifier and `created` flag. It does not print activation token material.

## Expected behavior

- The operation acquires a transaction-scoped advisory lock so concurrent first-admin attempts serialize.
- With no existing Platform administrator, it creates or reuses the configured Global User, assigns `platform_admin`, creates a host-bound activation token when the user is pending activation, writes the encrypted activation outbox event, and writes the bootstrap security-audit event in the same transaction.
- Re-running with the same normalized configured administrator email is idempotent and returns `created: false` for the existing assignment.
- If another administrator assignment already owns the bootstrap slot under a different email, the command fails closed rather than adding another bootstrap administrator.
- If the `platform_admin` role catalog is missing, bootstrap fails closed.

## Activate and verify

1. Confirm the bootstrap command returned successfully.
2. Confirm the activation message reaches the configured email transport. Do not copy the one-time fragment into tickets, logs, chat, or command history.
3. Complete activation on the exact Platform host.
4. Log in through the normal Platform browser flow.
5. Verify current-scope authorization through the normal application flow and confirm the expected Platform administrator permission set.
6. Run the identity-access gate:

   ```bash
   pnpm verify:identity-access
   ```

7. Disable `IDENTITY_BOOTSTRAP_ENABLED` through deployment configuration and redeploy. Keep the administrator email configuration only if the deployment policy requires it; bootstrap remains disabled.

## Failure handling

- **Database or migration error:** stop bootstrap and repair through a reviewed forward migration. Do not modify applied migration history.
- **SMTP unavailable:** preserve the successful transactional bootstrap state and restore the email worker/SMTP path. Do not mint or extract an activation token manually.
- **Wrong hostname:** correct the configured/operator hostname and rerun only if the first transaction did not establish a different bootstrap assignment.
- **Different administrator already bootstrapped:** treat this as a security/governance incident. Verify audit history and ownership before any recovery change.
- **Envelope/key configuration rejected:** repair runtime secret configuration; do not weaken validation or replace the keyring with a literal command-line value.

## Audit evidence

The successful first bootstrap writes a `platform.bootstrap_admin_created` security event with bounded metadata including action/result/reason, hostname, and platform scope. Operational notes should record environment, deployment commit, command result (`created` only), timestamp, and incident/change ticket. Do not record activation or session token material.
