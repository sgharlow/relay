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
 *   npx tsx --env-file=.env.local scripts/check-subscription.ts someone@example.com
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
