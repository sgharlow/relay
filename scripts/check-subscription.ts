/**
 * Reports whether an account has reached paid tier.
 *
 * Written for the live card test, and kept because it is the only way to answer
 * "did that payment actually register?" without reading the database by hand.
 *
 * It exists as a committed script rather than a scratch file specifically so it
 * is on every machine: the runbook tells someone to run this, and a runbook that
 * references a gitignored file is a runbook that fails on the second computer.
 *
 * Usage:
 *   npm run check:subscription -- someone@example.com
 *
 * OCCASION (D19, 2026-08-31). This was operator-run and belonged to no chain —
 * in no npm target, scheduled by nothing, its absence producing no failure. Two
 * occasions now own it:
 *   1. After ANY real checkout, against the buyer's address — the question it
 *      was written for ("did that payment actually register?"), and the only
 *      check that has ever caught stripe_customer_id arriving NULL.
 *   2. On every walk day, beside `npm run verify:orphans` — the standing D2
 *      cadence in ROADMAP §5, so the billing read happens on the days somebody
 *      is already reading production.
 * It CANNOT be scheduled unattended: it needs a database credential on a
 * runner, which is D21, Steve's call — the same wall as owner-mode a11y (B28).
 *
 * Reads only: SELECTs on users/subscriptions plus getEntitlement (read-only),
 * so it runs as `relay_ro` via .env.ro — the identity that cannot write.
 */

import { query, closeAllPools } from '../lib/db/connection';
import { getEntitlement } from '../lib/billing/entitlements';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.log('usage: scripts/check-subscription.ts <email>');
    await closeAllPools();
    return;
  }

  const u = await query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]);
  if (u.rows.length === 0) {
    console.log(`No account for ${email}.`);
    await closeAllPools();
    return;
  }
  const ownerId = u.rows[0].id;

  const s = await query<{
    tier: string;
    status: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  }>(
    `SELECT tier, status, stripe_customer_id, stripe_subscription_id
       FROM subscriptions WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [ownerId],
  );

  const row = s.rows[0];
  console.log('subscription:', row ? JSON.stringify(row) : '(no row yet — the webhook may not have arrived)');
  console.log('entitlement :', JSON.stringify(await getEntitlement(ownerId)));

  // The one field no automated test has ever exercised: Stripe's CLI fixtures
  // carry no customer object, so only a real browser checkout populates it.
  if (row && !row.stripe_customer_id) {
    console.log('\n⚠️  stripe_customer_id is NULL after a real purchase — that is a bug worth fixing before ad spend.');
  }

  await closeAllPools();
}

main();
