# Booking OS Pilot Design

**Date:** 2026-08-04  
**Status:** Approved design baseline  
**Repository:** `hiephanguyen01/booking-os`  
**Source baseline:** Booking SaaS + Multi-Tenant Marketplace — Master Spec V4.0

## 1. Purpose

Build and validate the first Booking OS tenant as an external-partner marketplace for bookable studios in Ho Chi Minh City. The Pilot must prove that a real transaction can move from partner onboarding and listing publication through booking, payment, completion, settlement, ledger, partner balance, payout, and reconciliation without direct database intervention.

The delivery strategy is vertical-slice-first:

`Partner → Listing → Availability → Quote → Booking → Payment → Completion → Settlement → Payout`

Each slice includes domain rules, database and RLS, API/BFF, UI, jobs, notifications, audit, observability, tests, and operating procedures.

## 2. Pilot business decisions

### 2.1 Marketplace and supply

- The first tenant is operated by the repository owner.
- The tenant is marketplace-only for the Pilot; there is no house partner.
- Supply starts from zero and is recruited manually in Ho Chi Minh City.
- Any legitimate studio type is allowed when it can be booked hourly or daily.
- Assisted self-service onboarding: a partner enters its own data, while tenant staff review and support before approval.
- A pending partner cannot create resources or listings.
- Pilot supply target: 5 active partners and at least 10 approved, available listings.
- Initial sourcing target: approximately 30 studios contacted, at least 10 interviews, and at least 3 early participation commitments.

### 2.2 Partner verification

Both individual and company partners are supported with separate checklists.

Required verification:

- identity or business registration;
- payout account;
- evidence of studio management rights.

Automated eKYC, mandatory video verification, and mandatory site visits are outside the Pilot.

### 2.3 Commercial model

- Total marketplace commission: 10% of final booking value.
- Partner share: 90%.
- Tenant revenue: 8%.
- Platform fee: 2%, included inside the total 10%.
- The physical payment flow sends customer funds directly to the tenant's PayOS account.
- The tenant is responsible for customer refunds and partner payouts.
- The platform does not collect customer funds on behalf of the tenant during the Pilot.

### 2.4 Payment policy

- Partner selects `deposit_percent` per listing within 30%–100%.
- Partner selects `balance_due` per listing:
  - `on_arrival`;
  - `online_before`.
- Default `balance_due`: `on_arrival`.
- Quote and booking snapshot the deposit percentage and balance method.
- Local and CI use `MockPaymentGateway`.
- Staging supports PayOS sandbox and controlled mock use.
- Production uses PayOS only; Mock must be impossible to enable.
- Payment success is confirmed only by a verified webhook, never by `returnUrl`.
- Refund is API-first; unsupported or failed provider refund becomes `manual_required` with an operational task and evidence.

### 2.5 Booking approval

A listing may use:

- Instant Booking; or
- Request to Book.

Instant Booking is the default.

For Request to Book:

- partner lead time is configurable per listing from 24 hours to 14 days;
- approval expiry is dynamic and capped at 12 hours;
- after approval, the customer has 2 hours to pay;
- a request is rejected at creation time when there is insufficient time for approval, payment, and safety buffer before service starts.

### 2.6 Cancellation policies

The tenant owns three standard policies. Partners choose one policy per listing and cannot define arbitrary percentages in the Pilot.

| Policy | 100% refund | 50% refund | No refund |
|---|---|---|---|
| Flexible | ≥48 hours | 24–48 hours | <24 hours |
| Standard | ≥7 days | 48 hours–7 days | <48 hours |
| Strict | ≥14 days | 7–14 days | <7 days |

The policy is snapshotted into the booking. Refund calculations use the amount already collected.

### 2.7 Payout policy

- Weekly payout every Friday.
- Holding period: 3 days after `completed`, or after a finalized no-show outcome.
- Minimum payout: 500,000 VND.
- Amounts below the threshold roll into a later cycle.
- Payouts include only available, undisputed balances.
- Tenant records bank reference and evidence.
- Failed payouts return eligible items to a later cycle only after confirming that funds did not leave the tenant account.

### 2.8 Pilot success and launch

Supply target:

- 5 active partners;
- 10 bookable listings.

Thirty-day transaction target:

- at least 10 paid bookings;
- at least 5 completed bookings;
- at least one real booking fully processed through payout.

Customer acquisition:

- tenant outreach;
- partner referrals;
- no paid advertising during the Pilot.

Launch stages:

1. Assisted launch for two weeks using direct listing links and operator support.
2. Public storefront only after the Go/No-Go gate passes.

Public launch gate:

- 5 active partners;
- 10 available listings;
- 3 real completed bookings;
- API refund and manual fallback tested;
- no critical tenant-isolation, payment, double-booking, or finance defects;
- explicit tenant approval.

## 3. System architecture

Keep a modular monolith during the Pilot.

```text
Browser
 ├─ web-storefront
 │   └─ public search, listing, availability, checkout, customer portal
 └─ web-console
     └─ platform, tenant, partner operations
          │
          ▼
       Next.js BFF
          │
          ▼
      NestJS API
          ├─ PostgreSQL
          ├─ Redis
          ├─ Object Storage
          └─ Inbox / Outbox / BullMQ
                 ├─ critical worker
                 └─ batch worker
```

### 3.1 Runtime responsibilities

- `web-storefront`: public SEO, listing discovery, availability, quote, checkout, guest booking portal.
- `web-console`: tenant, partner, and platform operations.
- `api`: domain invariants and application commands.
- `worker-critical`: webhook, expiry, reconciliation, critical transitions, and transactional notifications.
- `worker-batch`: reports, payout batches, cleanup, and lower-urgency scheduled work.

### 3.2 BFF and session boundary

- Browser does not hold access tokens.
- Browser calls Next.js Route Handlers or Server Actions.
- Session cookies are `HttpOnly`, `Secure`, and appropriate `SameSite`.
- BFF derives user, tenant, and partner scope from session and host.
- API does not trust client-supplied tenant or partner identifiers.
- Custom domains resolve to tenant context before application commands run.

### 3.3 Bounded modules

- `identity-access`: users, sessions, OTP, passwords, memberships, role assignments, permission evaluation.
- `tenancy`: tenants, domains, settings, commission and payout policy, feature flags.
- `partner`: partner profile, lifecycle, verification, payout account, members.
- `catalog`: listing types, listing groups, listings, resources, media, moderation, publication.
- `scheduling`: weekly availability, exceptions, blocks, buffers, slot generation, conflict checks.
- `pricing-quote`: base and block pricing, simple pricing rules, promotion validation, quote and snapshots.
- `booking`: booking aggregate, holds, state machine, expiry, cancellation, no-show, disputes, history.
- `payments`: payment intents, provider adapters, webhook inbox, refunds, reconciliation.
- `finance`: settlement, ledger, partner payable, balances, payouts, reconciliation.
- `notifications`: templates, delivery requests, retries, delivery status.
- `operations-audit`: audit log, operational task, dead-letter review, evidence, operational metrics.

Each module has one write owner. Modules communicate through ports and events, not through another module's repository.

## 4. Data ownership and core model

Every tenant-owned table contains `tenant_id`, even when tenant scope could be inferred through a relationship.

| Domain | Main records | Write owner |
|---|---|---|
| Identity | users, sessions, memberships, roles, role assignments | Identity |
| Tenancy | tenants, domains, settings, gateway configuration | Tenancy |
| Partner | partners, members, verification, payout accounts | Partner |
| Catalog | listing types, groups, listings, resources, media | Catalog |
| Scheduling | availability rules, exceptions, resource blocks | Scheduling |
| Pricing | pricing rules, cancellation policies, quotes | Pricing |
| Booking | bookings, holds, status history, no-show evidence, disputes | Booking |
| Payments | payments, webhook inbox, refunds | Payments |
| Finance | settlements, accounts, journals, entries, payouts, payout items | Finance |
| Reliability | outbox events, audit logs, operational tasks | Operations |

### 4.1 Partner aggregate

```text
Partner
├── tenant_id
├── partner_type: individual | company
├── status: pending | active | inactive | suspended | cancelled
├── verification_status
├── payout_account_status
└── management_rights_status
```

Rules:

- only `active` partners may create inventory;
- suspension cannot orphan future confirmed bookings;
- payout requires a verified payout account;
- lifecycle actions create history, audit, and outbox events.

### 4.2 Listing and resource

`Listing` is the unit sold to customers. `Resource` is the unit whose calendar is locked.

A listing may enable both `hourly` and `daily` against the same resource.

```text
Listing
├── listing_type_id
├── resource_id
├── status
├── enabled_modes[]
├── mode_config
├── deposit_percent
├── balance_due
├── approval_required
└── cancellation_policy_id
```

Daily defaults:

- check-in 09:00;
- check-out 18:00 on the same day.

All calculations use the resource timezone and persist canonical timestamps in UTC.

### 4.3 Booking aggregate

```text
Booking
├── tenant_id
├── partner_id
├── listing_id
├── resource_id
├── customer_id
├── mode
├── timeslot: tstzrange
├── status
├── approval_expires_at
├── payment_expires_at
├── pricing_snapshot
├── commission_snapshot
├── policy_snapshot
├── booking_config_snapshot
├── version
└── created_source
```

`created_source`:

- `storefront`;
- `partner_manual`;
- `tenant_assisted`.

### 4.4 Immutable snapshots

At booking creation, snapshot:

- base price and applied pricing rules;
- discounts and funding source;
- final amount;
- deposit and balance obligation;
- commission split;
- cancellation policy;
- mode, timezone, check-in/out, and buffers;
- approval mode and deadlines;
- lead time.

Current configuration must never be used to recompute historical bookings.

## 5. State machines

### 5.1 Booking

```text
                         ┌────────────────┐
                         │pending_approval│
                         └───────┬────────┘
                           approve│   │ reject/timeout
                                  ▼   ▼
draft ───────────────────► pending_payment ─────► expired
  │                              │
  │                              │ verified webhook
  │                              ▼
  └────────────────────────► confirmed
                                  │
                 ┌────────────────┼─────────────────┐
                 ▼                ▼                 ▼
             cancelled         completed         no_show
                 │
                 ▼
              refunded
```

Rules:

- Instant Booking: `draft → pending_payment`.
- Request to Book: `draft → pending_approval`.
- Partner-created booking: `draft → pending_payment`.
- `pending_approval → pending_payment` only through partner approval before deadline.
- `pending_approval → rejected` through partner rejection or timeout.
- `pending_payment → confirmed` only through a verified, idempotent provider result and final slot check.
- `pending_payment → expired` on payment timeout.
- late successful webhook restores the booking only when the slot remains available; otherwise create a refund.
- customer cancellation uses the policy snapshot.
- partner or tenant cancellation refunds 100%.
- `confirmed → completed` is a system job at `timeslot.end + 24h` when no dispute or no-show exists.
- `confirmed → no_show` is partner-only, from service end through the next 24 hours, with reason and evidence.
- terminal states are not rewritten; correction uses a new workflow or reversal.
- every transition includes actor, reason, history, audit, and outbox.

### 5.2 No-show and dispute

- Partner must submit a standardized reason and at least one evidence item.
- Customer receives notification and has 72 hours to dispute.
- Tenant is the final decision-maker.
- Settlement and payout remain held while a dispute is open.
- A valid no-show is normally non-refundable and finances only the amount actually collected.

### 5.3 Payment

Canonical state vocabulary:

```text
requires_action → processing → succeeded
                            ├─→ failed
                            └─→ expired
```

Provider status is stored separately. `succeeded` is terminal; a later failed event cannot reverse it.

### 5.4 Refund

```text
requested → processing → succeeded
    │             ├──────→ failed
    │             └──────→ manual_required
    └────────────→ rejected
```

`manual_required` creates an operational task. Manual completion requires actor, reason, bank reference, and evidence.

### 5.5 Settlement and payout

```text
Settlement: draft → calculated → posted → reversed
Payout:     draft → prepared → approved → processing → paid
                                               └──────→ failed
```

Posted settlement and ledger entries are immutable. Corrections use reversal and new journals.

## 6. Availability and concurrency invariants

```text
Weekly Schedule
+ Exceptions
- Resource Blocks
- Pending/Confirmed Occupancy
- Active Holds
= Available Slots
```

Required invariants:

1. UTC persistence with resource-timezone computation and display.
2. Hourly and daily bookings use the same range-based conflict model.
3. Buffers are part of occupied time.
4. `pending_approval`, `pending_payment`, and `confirmed` occupy the resource.
5. Redis Hold is temporary UX protection, not final truth.
6. PostgreSQL transaction and exclusion constraint are final protection.
7. Availability search does not reserve inventory.
8. Concurrent requests cannot produce overlapping accepted occupancy.
9. Schedule closure affecting future bookings creates an operational task.

## 7. Pricing and finance invariants

All money is integer VND.

Commission split:

```text
Partner share = 90% final amount
Tenant revenue = 8% final amount
Platform fee = 2% final amount
```

For `on_arrival`:

```text
Partner payable
= Partner share
- amount collected by partner on arrival
- clawback
- adjustment
```

Financial invariants:

- every journal balances debit and credit;
- posted journals are append-only;
- corrections use reversal;
- refund cannot exceed refundable collected amount;
- payout cannot exceed available partner balance;
- provider transactions and idempotency keys are unique;
- settlement, partner balance, payout, and reports reconcile to ledger;
- mismatches create findings and tasks, never blind auto-correction.

## 8. Actor UX flows

### 8.1 Partner onboarding

```text
Create account
→ verify email
→ select individual/company
→ profile
→ payout account
→ management-rights evidence
→ submit
→ tenant review
→ active
```

Pending partners may edit their application but cannot create inventory.

### 8.2 Listing wizard

```text
Studio information
→ location/timezone
→ resource
→ media/amenities
→ hourly/daily modes
→ price/duration
→ schedule
→ booking policy
→ cancellation policy
→ preview/submit
```

New and materially edited listings enter moderation. Tenant-hidden content cannot be republished by the partner.

### 8.3 Customer flow

```text
Search/direct link
→ listing
→ hourly/daily availability
→ quote
→ guest contact information
→ email OTP
→ booking/request
→ PayOS
→ confirmation
```

Guest checkout requires name, email, and phone. Email OTP is mandatory before payment. Guest customers can later upgrade to a password account without losing booking history.

### 8.4 Partner-assisted booking

Partner may create a booking for a customer and send an online payment link. The slot is held for 2 hours. Offline cash or external-transfer confirmation is not supported.

### 8.5 Customer booking portal

Booking code plus email OTP provides access to:

- booking status;
- payment and balance information;
- cancellation and refund preview;
- receipts;
- no-show dispute;
- account upgrade.

Customer self-rescheduling is outside the Pilot.

### 8.6 Tenant operations

Tenant manages:

- partner review;
- listing moderation;
- booking cancellation;
- refund tasks;
- no-show disputes;
- partner cancellation warnings and suspension review;
- payout preparation and evidence;
- operational workbench.

## 9. API design principles

- All browser traffic goes through the BFF.
- API is versioned under `/v1`.
- Important POST commands require `Idempotency-Key`.
- Aggregate updates require `expectedVersion`.
- Error responses use stable business codes and request IDs.
- Amounts are integer VND.
- Dates are ISO 8601 UTC; local display includes resource timezone.
- Public requests cannot supply authoritative tenant scope.
- OpenAPI is the contract source for request, response, permissions, and error codes.

Representative endpoint groups:

```text
/v1/partner-applications/*
/v1/tenant/partner-applications/*
/v1/partner/resources/*
/v1/partner/listings/*
/v1/tenant/listing-reviews/*
/v1/public/listings/*
/v1/public/quotes
/v1/public/holds
/v1/public/otp/email/*
/v1/public/bookings/*
/v1/partner/bookings/*
/v1/tenant/bookings/*
/v1/tenant/disputes/*
/v1/tenant/payouts/*
```

## 10. Reliability pattern

Each important command uses one transaction:

```text
validate command
→ mutate aggregate
→ write history/audit
→ write outbox event
→ commit
→ worker performs side effects
```

Inbox and outbox guarantee that:

- duplicate webhook delivery does not duplicate business effects;
- worker retry does not duplicate notifications or finance entries;
- provider and queue failures can be reconciled;
- distributed transactions are unnecessary.

## 11. Tenant isolation and security

- PostgreSQL `FORCE ROW LEVEL SECURITY` on every tenant-owned table.
- Tenant context is attached to each transaction.
- Repository access requires tenant context.
- Background jobs carry explicit tenant scope.
- Platform bypass uses a dedicated audited path.
- Cross-tenant tests cover API, database, cache, worker, and export.
- Opaque session IDs with rotation and revoke.
- CSRF, strict CORS, rate limiting, OTP throttling, and upload validation.
- KYC, gateway credentials, and full bank details are restricted data.
- Restricted files remain private and are accessed with short-lived signed URLs and audit.
- Secrets, OTP, KYC contents, and full bank details are never logged.

## 12. Testing strategy

Testing follows risk:

1. domain invariant tests;
2. PostgreSQL and Redis integration tests;
3. API/BFF contract tests;
4. browser E2E tests;
5. concurrency, failure, and recovery tests.

Mandatory scenarios:

- cross-tenant read/write denial;
- hourly/hourly, daily/daily, and hourly/daily conflict;
- buffer overlap;
- hold expiry and conversion;
- duplicate, out-of-order, and late webhook;
- amount/currency mismatch;
- Redis outage;
- worker crash and retry;
- refund API failure and manual fallback;
- settlement and journal balance;
- payout threshold, holding period, and failed payout recovery;
- backup restore and deployment rollback.

## 13. Observability and operations

Every request/job includes:

- `requestId`;
- `traceId`;
- `tenantId`;
- `actorId` and type;
- aggregate type and ID;
- job ID when applicable.

Critical alerts:

- suspected cross-tenant leakage;
- unbalanced journal attempt;
- confirmed double booking;
- succeeded payment without resolvable booking;
- Mock gateway enabled in production;
- webhook verification unavailable;
- financial data changed outside a workflow.

Operational task types include:

- payment reconciliation required;
- manual refund required;
- late payment after slot loss;
- partner cancellation review;
- no-show dispute;
- payout failed;
- ledger reconciliation mismatch;
- listing contact leakage review;
- future bookings affected by suspension;
- dead-letter review.

Operational work must not require direct SQL edits.

## 14. Delivery roadmap

Use two-week vertical-slice sprints as a baseline, adjusted to actual team capacity.

| Sprint | Outcome |
|---|---|
| 0 | Foundation Completion |
| 1 | Identity & Multi-Tenancy |
| 2 | Partner Onboarding |
| 3 | Partner to Bookable Inventory |
| 4 | Customer to Confirmed Booking |
| 5 | Completion, Cancellation, Refund, No-show |
| 6 | Settlement, Ledger, Partner Balance, Payout |
| 7 | Assisted Pilot and Public Launch |

### Sprint 0 — Foundation Completion

- health/readiness and graceful shutdown;
- environment validation;
- request and trace IDs;
- structured logging;
- OpenAPI and standard errors;
- BFF session and CSRF proof;
- tenant-context propagation and local custom-domain routing;
- Prisma migration workflow and RLS proof;
- inbox/outbox and worker retry/dead-letter skeleton;
- PostgreSQL/Redis integration harness;
- Playwright smoke;
- CI quality gates.

### Sprint 1 — Identity & Multi-Tenancy

- global user and email OTP foundation;
- password and reset;
- opaque sessions, rotation, revoke;
- tenant, membership, role assignment;
- tenant domain resolution;
- commission, payment, and payout settings;
- RLS and cross-tenant tests.

### Sprint 2 — Partner Onboarding

- individual/company application;
- verification and restricted file upload;
- payout account and management-rights evidence;
- submit, changes requested, approve, reject;
- notifications, history, audit;
- active-partner inventory guard.

### Sprint 3 — Bookable Inventory

- resource and listing lifecycle;
- hourly and daily modes;
- scheduling, exceptions, blocks, buffers;
- range conflict and Redis hold;
- pricing and quote snapshot;
- listing moderation and contact-leakage checks.

### Sprint 4 — Confirmed Booking

- storefront listing and availability;
- guest checkout and OTP;
- Instant Booking;
- Request to Book;
- partner-assisted booking;
- Mock and PayOS adapters;
- webhook inbox, verification, expiry, and reconciliation.

### Sprint 5 — Finalized Booking

- customer cancellation and refund preview;
- partner/tenant cancellation with full refund;
- API refund and manual fallback;
- auto-complete after 24 hours;
- no-show evidence, dispute, and tenant resolution;
- cancellation metrics and partner review tasks.

### Sprint 6 — Finance and Payout

- settlement snapshot;
- balanced append-only ledger;
- partner payable and available balance;
- holding period and Friday payout batch;
- minimum payout threshold;
- evidence and failed-payout recovery;
- daily reconciliation.

### Sprint 7 — Pilot Launch

- production PayOS verification;
- training and runbook drills;
- assisted launch with direct listing links;
- daily incident and reconciliation review;
- public-storefront Go/No-Go.

## 15. Definition of Done

A vertical slice is complete only when it includes:

- migration and RLS;
- domain invariant;
- application command;
- OpenAPI contract;
- BFF integration;
- UX states;
- inbox/outbox job behavior;
- notification;
- audit and metrics;
- unit, integration, and E2E tests;
- runbook when operational action is possible;
- recovery or rollback path.

No direct database intervention is accepted in a demo or Pilot operating procedure.

## 16. Out of Pilot scope

- inventory, appointment, and class booking modes;
- customer self-rescheduling;
- in-app chat;
- offline/cash manual booking confirmation;
- automated partner financial penalties;
- advanced affiliate features;
- MoMo and VNPay;
- tenant self-service signup;
- automated eKYC;
- advanced promotions;
- platform collection of customer funds;
- microservices.

New requests are classified as:

- P0: required for the Pilot transaction path;
- P1: reduces launch risk;
- P2: post-Pilot.

P2 work does not enter the Pilot critical path without an explicit scope decision.

## 17. Design deltas requiring ADR and Decision Index updates

The following approved Pilot decisions differ from, or extend, the original baseline and must be recorded explicitly:

- hourly and daily modes in the Pilot;
- partner choice of Instant Booking or Request to Book;
- Request to Book dynamic deadline capped at 12 hours;
- two-hour customer payment deadline;
- Request to Book lead time of 24 hours–14 days;
- no-show marking window changed to 24 hours;
- refund API-first with manual fallback;
- Friday weekly payout, three-day holding period, and 500,000 VND minimum;
- cancellation policy set and commission split defined in this document.

## 18. Final success criteria

Engineering Pilot is complete when:

1. tenant can onboard partners and publish listings without database edits;
2. guest customer can search, quote, verify email, pay, and receive confirmation;
3. Instant, Request to Book, and partner-assisted flows run;
4. booking reaches completed, cancelled/refunded, or no-show outcomes correctly;
5. completed booking creates settlement and a balanced ledger;
6. partner balance and Friday payout work;
7. at least one real transaction reaches payout;
8. cross-tenant, concurrency, and finance reconciliation gates pass;
9. refund, payout, provider outage, backup, and rollback runbooks have been exercised;
10. monitoring, alerting, support, and operational ownership are active.

Product Pilot shows continuation signal when it reaches the supply and transaction targets and produces evidence that tenant outreach or partner referral can repeatedly create real bookings without critical trust, reliability, or financial failures.
