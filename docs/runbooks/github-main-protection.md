# GitHub Main Branch Protection

## Target branch

`main`

## Required settings

- Require a pull request before merging: ON
- Required approvals: 0
- Require status checks to pass before merging: ON
- Require branches to be up to date before merging: ON
- Require conversation resolution before merging: ON
- Allow force pushes: OFF
- Allow deletions: OFF

## Required status contexts

Use the actual successful job/check names from the current repository baseline:

```text
Docker Compose configuration
Quality
Knowledge validation
OpenAPI compatibility
Unit, API E2E, and RLS tests
Migration verification
Build
Playwright foundation smoke
Production configuration guard
Security
Hexagonal API boundaries
Genesis tooling
OpenAPI contract
Mailpit identity email delivery
```

GitHub only offers a context in the protection UI after that check has run recently in the repository. Do not substitute workflow filenames such as `ci.yml` for these job/check names.

## Apply in GitHub Settings

1. Open the repository.
2. Go to **Settings -> Branches -> Add branch protection rule**.
3. Set **Branch name pattern** to `main`.
4. Enable **Require a pull request before merging**.
5. Keep required approvals at `0` for the current solo-development workflow.
6. Enable **Require status checks to pass before merging**.
7. Enable **Require branches to be up to date before merging**.
8. Select every required status context listed above.
9. Enable **Require conversation resolution before merging**.
10. Keep **Allow force pushes** disabled.
11. Keep **Allow deletions** disabled.
12. Save the rule.

If GitHub presents a ruleset UI instead of classic branch protection, apply the equivalent policy to branch target `main` with the same required contexts and zero-approval requirement.

## Verification

After applying the rule, verify the branch protection endpoint reports:

```text
required_status_checks.strict = true
required_pull_request_reviews enabled with required approvals = 0
required_conversation_resolution.enabled = true
allow_force_pushes.enabled = false
allow_deletions.enabled = false
all required status contexts present
```

Also confirm the `main` branch metadata reports the branch as protected.

## Automation status

Not applied by the connected GitHub integration as of 2026-08-09 because the available connector does not expose branch-protection mutation. Apply the policy through repository Settings using the steps above, then rerun the verification check. Do not treat this policy as active until a fresh protection read confirms it.
