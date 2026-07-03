# G4 — Billing MVP design (docs-only; NO build until G1 passes)

> Drafted 2026-07-03 on `exp/g1-caregiver-landing` (in-lock relay prep). Turns spec
> `Relay_H0_Build_Spec_v2.md` §24 revenue prose into a buildable plan, closing the 7-01 audit
> finding "zero billing code on a Monetizable-B2C track." **Sequencing is absolute:**
> build starts only after the G1 WTP gate passes (≥2% click-to-intent), and **no live charge is
> ever taken before the G2 counsel opinion** (fiduciary/custodian status) — G2 is a pre-revenue
> requirement, not a nice-to-have.

## Scope decision (MVP = one revenue line)

Of §24's four revenue lines, the billing MVP implements ONLY:

- **Consumer annual subscription — $119/yr** (ratified 2026-07-03, `g1-wtp-test-design.md`).

Explicitly deferred:
- **Activation fee at the moment of need** — charging a family mid-emergency/probate is the most
  legally and ethically sensitive money event in the product; it needs G2 counsel input on both
  amount and framing before it is designed, let alone built.
- Partner licensing / white-label and premium add-ons — post-G3 (first B2B2C pilot LOI).

## Stripe object model

| Object | Value | Notes |
|---|---|---|
| Product | `relay-family-vault` | one product, one edition for MVP |
| Price | `$119/yr`, `recurring.interval=year` | lookup_key `relay_annual_v1` so price changes are additive, never edits |
| Checkout | Checkout Session, `mode=subscription` | no card form of our own — Stripe-hosted only |
| Customer | 1:1 with owner | `stripe_customer_id` stored on the owner row |
| Portal | Stripe Customer Portal | self-serve cancel/card-update; zero custom UI |
| Webhooks | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` | single `/api/stripe/webhook` route, signature-verified |

## Entitlement model (app-layer, same discipline as the rest of the schema)

New table `entitlements` (UUID PK, no FK — integrity via `lib/db/integrity.ts` helpers, per the
DSQL convention): `owner_id`, `plan` (`free` | `family`), `status`
(`active`|`past_due`|`canceled`), `stripe_customer_id`, `stripe_subscription_id`,
`current_period_end`, `version` (OCC). Webhook writes go through `withOccRetry()` like every
racing write.

**Proposed gating matrix (DRAFT — Steve ratifies at G4 kickoff, not now):**

| Capability | Free | Family ($119/yr) |
|---|---|---|
| Vault items | up to 10 | unlimited |
| Recipients | 1 | unlimited |
| Triggers | manual emergency only | all (check-in, emergency, verified estate) |
| Verifiers (N-of-M) | — | ✓ |
| Audit-chain browser verification | ✓ | ✓ (trust features are never paywalled) |

Principle embedded above: **safety and verifiability are never behind the paywall**; capacity and
orchestration are.

## Infra prerequisite (flag, not a decision)

The demo DSQL pair is torn down post-judging (7-25 runbook). Billing presupposes a re-provisioned
production data layer. Options at G4 kickoff: fresh DSQL pair (residency story, §22) vs.
single-region DSQL vs. managed Postgres. That is an infra-policy decision (snapshot/rollback
discipline, Steve's call) made when G1 passes — deliberately NOT made in this doc.

## Build estimate & acceptance

~2–3 sessions once unblocked: migration + entitlements module (0.5), checkout + webhook + portal
routes with signature verification and OCC (1), gating middleware + tests + e2e in Stripe test
mode (1). **Acceptance:** a test-mode subscription completes end-to-end (checkout → webhook →
entitlement flips → gate opens → portal cancel → gate closes), suite green, zero plaintext card
data anywhere near our servers. **Live-mode toggle is gated on G2 counsel opinion — hard stop.**
