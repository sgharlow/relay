/**
 * Give a founding family the paid tier, without charging them.
 *
 * 🔴 THE PRODUCT MADE A PROMISE IT HAD NO MECHANISM FOR. Both entitlement
 * ceilings tell an owner, verbatim: "Email us if you need more — we are
 * onboarding founding families by hand." There was no by-hand path. The only
 * route to `paid` was the Stripe webhook, so the honest answers to a founding
 * family hitting the 10-item cap on day one were "pay $119" or "no" — and the
 * free vault is ten items against a demo vault of twenty-five.
 *
 *   npx tsx --env-file=.env.local scripts/grant-founding-tier.ts <email>
 *   npx tsx --env-file=.env.local scripts/grant-founding-tier.ts <email> --revoke
 *
 * ⚠️ A COMP MUST NEVER LOOK LIKE REVENUE. This portfolio's whole discipline is
 * arms-length revenue evidence; PROJECT.yaml records `wtp_evidence: none` and
 * treats one self-purchased subscription as advancing nothing. A hand-granted
 * row is structurally identical to a customer's — same table, same tier, same
 * active status — so it is marked twice and unmistakably (`cohort` and
 * `price_cents = 0`, see lib/billing/entitlements.ts COMP_COHORT) and this
 * script REFUSES to touch a row carrying Stripe identifiers. Overwriting a real
 * subscriber to comp them would both lose their billing linkage and delete the
 * evidence the gate is waiting for.
 *
 * The grant is written to the owner's audit chain, because a change to who can
 * do what belongs in the record the audit page promises holds what happened.
 */

import { query, closeAllPools } from '../lib/db/connection';
import { writeAuditEntry } from '../lib/audit/audit-service';
import { COMP_COHORT } from '../lib/billing/entitlements';

interface SubRow {
  id: string;
  tier: string;
  status: string;
  cohort: string | null;
  price_cents: number | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
}

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  const revoke = process.argv.includes('--revoke');

  if (!email) {
    console.error('usage: grant-founding-tier.ts <email> [--revoke]');
    process.exit(2);
  }

  const user = await query<{ id: string; email: string; is_demo_account: boolean }>(
    `SELECT id, email, is_demo_account FROM users WHERE lower(email) = $1 LIMIT 1`,
    [email],
  );
  const owner = user.rows[0];
  if (!owner) {
    console.error(`No account for ${email}. Nothing changed.`);
    process.exit(1);
  }
  if (owner.is_demo_account) {
    // Demo rows already resolve to `paid` in getEntitlement; writing a comp for
    // one would be a row that means nothing and confuses the next reader.
    console.error(`${email} is a demo account — it already resolves to paid. Nothing changed.`);
    process.exit(1);
  }

  const existing = await query<SubRow>(
    `SELECT id, tier, status, cohort, price_cents, stripe_subscription_id, stripe_customer_id
       FROM subscriptions WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [owner.id],
  );
  const row = existing.rows[0];

  // Never touch a real payer. Their row carries billing linkage the webhook
  // maintains, and their subscription is the evidence the G1 gate wants.
  if (row?.stripe_subscription_id || row?.stripe_customer_id) {
    console.error(
      `${email} has a Stripe subscription on record. Refusing to overwrite a paying ` +
        `customer — comp them in Stripe instead, or cancel there first. Nothing changed.`,
    );
    process.exit(1);
  }

  const tier = revoke ? 'free' : 'paid';

  if (row) {
    await query(
      `UPDATE subscriptions
          SET tier = $2, status = 'active', cohort = $3, price_cents = 0, updated_at = now()
        WHERE id = $1`,
      [row.id, tier, COMP_COHORT],
    );
  } else {
    if (revoke) {
      console.log(`${email} has no subscription row; free is already the default. Nothing changed.`);
      await closeAllPools();
      return;
    }
    await query(
      `INSERT INTO subscriptions (owner_id, tier, status, price_cents, cohort)
       VALUES ($1, $2, 'active', 0, $3)`,
      [owner.id, tier, COMP_COHORT],
    );
  }

  // Blocking, like every audit write: a change to what somebody may do that
  // cannot be recorded should not complete.
  await writeAuditEntry(owner.id, {
    actor: 'system',
    action: revoke ? 'founding_tier_revoked' : 'founding_tier_granted',
    entity: 'subscription',
    entityId: owner.id,
    detail: { tier, cohort: COMP_COHORT, comped: true },
  });

  console.log(
    revoke
      ? `${email} returned to the free tier. Their vault is untouched; free limits apply to ADDING more.`
      : `${email} now has the paid tier as a founding family — marked comped (price_cents 0, cohort ${COMP_COHORT}), so it can never be counted as revenue.`,
  );
  await closeAllPools();
}

main().catch((e) => {
  console.error('FAILED:', e?.message ?? e);
  process.exit(1);
});
