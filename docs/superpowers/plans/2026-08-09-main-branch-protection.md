# Main Branch Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect `main` so changes flow through pull requests and cannot merge until the repository's stable CI, architecture, Sprint 0, and identity-email checks have passed, while preserving the current solo-development workflow with zero required approvals.

**Architecture:** Use GitHub branch protection for `main`, requiring pull requests, strict up-to-date status checks, no force pushes, and no branch deletion. The exact required contexts are the current successful job check names, not guessed workflow filenames; repository documentation records both the intended policy and how to verify it.

**Tech Stack:** GitHub branch protection, GitHub Actions, repository runbook documentation.

## Global Constraints

- Protect only `main` in this plan.
- Require pull requests before merging.
- Required approving review count remains `0`.
- Require status checks and require the branch to be up to date before merge.
- Block force pushes and branch deletion.
- Do not bypass checks for documentation-only changes.
- Use actual successful job check names from the current `main` baseline.
- Do not claim protection was applied unless a fresh repository protection read confirms it.
- The connected GitHub capability currently exposes protection reads but no branch-protection mutation; if no alternate authenticated mutation path is available, document the exact remaining repository-settings action truthfully.

---

### Task 1: Record the exact required check contexts and protection policy

**Files:**
- Create: `docs/runbooks/github-main-protection.md`

**Interfaces:**
- Consumes: successful `main` workflow runs for CI, API architecture boundaries, Sprint 0 gates, and Identity email integration.
- Produces: authoritative required-check list and repository-settings policy for `main`.

- [ ] **Step 1: Capture current successful job names from `main`**

Verify the current baseline exposes these successful check-run/job names:

```text
Docker Compose configuration
Quality
Knowledge validation
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

For pull requests, also require:

```text
OpenAPI compatibility
```

Do not substitute workflow filenames such as `ci.yml` for these check names.

- [ ] **Step 2: Write the runbook with exact target settings**

Create `docs/runbooks/github-main-protection.md` with:

```markdown
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
```

Document the required contexts exactly:

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

Explain that GitHub only offers a context in the settings UI after that check has run recently in the repository.

- [ ] **Step 3: Document exact GitHub Settings UI application steps**

Add:

```text
Repository -> Settings -> Branches -> Add branch protection rule
Branch name pattern: main
Enable Require a pull request before merging
Set required approvals to 0
Enable Require status checks to pass before merging
Enable Require branches to be up to date before merging
Select every required context listed above
Enable Require conversation resolution before merging
Keep Allow force pushes disabled
Keep Allow deletions disabled
Save changes
```

If GitHub presents a ruleset UI instead of classic branch protection, apply the equivalent policy to branch target `main`, preserving the same required contexts and zero-approval requirement.

- [ ] **Step 4: Commit the policy runbook**

```bash
git add docs/runbooks/github-main-protection.md
git commit -m "docs: define main branch protection policy"
```

---

### Task 2: Apply protection through an available authenticated GitHub mutation path and verify state

**Files:**
- Modify: `docs/runbooks/github-main-protection.md` only if the actual GitHub UI/API names differ from the captured baseline.

**Interfaces:**
- Consumes: Task 1 policy.
- Produces: verified `main` protection or a precise recorded connector limitation with no false success claim.

- [ ] **Step 1: Check whether the active GitHub integration exposes branch-protection mutation**

Look for an authenticated operation equivalent to GitHub REST:

```text
PUT /repos/hiephanguyen01/booking-os/branches/main/protection
```

Do not use an unauthenticated raw HTTP request and do not invent a mutation method on a read-only connector.

- [ ] **Step 2: If an authenticated mutation path exists, apply this policy**

Equivalent REST body:

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Docker Compose configuration",
      "Quality",
      "Knowledge validation",
      "OpenAPI compatibility",
      "Unit, API E2E, and RLS tests",
      "Migration verification",
      "Build",
      "Playwright foundation smoke",
      "Production configuration guard",
      "Security",
      "Hexagonal API boundaries",
      "Genesis tooling",
      "OpenAPI contract",
      "Mailpit identity email delivery"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
```

If the provider rejects a field because its branch-protection API version differs, inspect the provider's current schema and make the minimal semantic equivalent; do not weaken the target policy to make the call pass.

- [ ] **Step 3: If no mutation path exists, stop at an explicit external-settings checkpoint**

Record in the runbook:

```text
Automation status: not applied by the connected GitHub integration because it does not expose branch-protection mutation. Apply the policy through repository Settings using the steps above, then rerun the verification step below.
```

Do not mark protection complete.

- [ ] **Step 4: Verify protection from GitHub after application**

Read:

```text
GET /repos/hiephanguyen01/booking-os/branches/main/protection
```

Required evidence:

```text
required_status_checks.strict = true
required_pull_request_reviews is enabled with required approvals = 0
required_conversation_resolution.enabled = true
allow_force_pushes.enabled = false
allow_deletions.enabled = false
all required status contexts are present
```

Also read `main` branch metadata and confirm the branch reports protected.

- [ ] **Step 5: Update the runbook status only from fresh evidence**

If verified on this implementation cycle, add:

```text
Automation status: applied and verified on 2026-08-09.
```

If not verified, keep the limitation/open checkpoint text.

- [ ] **Step 6: Commit any verified-status documentation change**

```bash
git add docs/runbooks/github-main-protection.md
git commit -m "docs: record main protection status"
```

Do not create an empty commit if the connector limitation remains unchanged.
