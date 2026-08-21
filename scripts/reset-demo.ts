/**
 * Reset the demo account to a pristine seeded state.
 *
 *   npx tsx scripts/reset-demo.ts        (needs the DSQL env vars — see docs/aws-setup.md)
 *
 * The demo seed (db/seeds/demo-seed.ts) is INSERT-only and not idempotent, so
 * re-running it would duplicate the demo owner. This script first wipes every
 * row belonging to the demo owner across all tables, then re-seeds — leaving a
 * clean 25-item vault with both release states ARMED. Run it right before
 * recording the demo (the public site keeps accruing guest changes / a prior
 * dogfood may have advanced a release).
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.1 (demo dataset), demo ops.
 */

import { query, closeAllPools } from '../lib/db/connection';
import { seedDemo } from '../lib/seed/seed-runner';
import { deleteAccount } from '../lib/account/lifecycle';

const DEMO_EMAIL = 'demo@relay.test';

/**
 * Delete every row owned by `ownerId`.
 *
 * 🔴 THIS USED TO BE A HAND-WRITTEN LIST OF SEVEN TABLES, and the header above
 * describes exactly why that could not hold: the public site keeps accruing
 * guest changes. Every one of those changes lands in a table the list did not
 * name — invitations, access_requests, delegations and their consent_artifacts,
 * approvals, access_policies, recipient_codes and verifier_codes, break_glass
 * codes, recovery codes, passkeys, auth_challenges. `deleteAccount()` purges
 * twenty-one tables and this named six of them plus users, so every reset
 * orphaned whatever had accrued since the last one, on the production cluster,
 * and re-seeded a NEW owner id that could never be joined back to them.
 *
 * The cascade is also the only thing that releases the standby roles this user
 * holds in other owners' rosters — rows a `WHERE owner_id = $1` cannot see.
 *
 * ⚠️ AND THEN THE AUDIT LOG, WHICH THE CASCADE DELIBERATELY KEEPS. deleteAccount
 * retains audit_log because closing a real person's account must not erase the
 * record that it happened. A demo reset is a different act: the seed mints a new
 * owner id, so a retained row would be an orphan pointing at a user that no
 * longer exists — the very thing this function was failing to prevent. So it is
 * removed here, explicitly, after the cascade has returned.
 */
async function wipeOwner(ownerId: string): Promise<void> {
  await deleteAccount(ownerId);
  await query(`DELETE FROM audit_log WHERE owner_id = $1`, [ownerId]);
}

async function main(): Promise<void> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [DEMO_EMAIL],
  );
  for (const row of existing.rows) {
    await wipeOwner(row.id);
  }

  const r = await seedDemo();
  console.log(
    `Reset demo: wiped ${existing.rows.length} prior owner row(s); reseeded ` +
      `${r.items} items, ${r.recipients} recipients, ${r.verifiers} verifiers, ` +
      `${r.rules} rules, ${r.releaseStates} release states (all ARMED).`,
  );
}

main()
  .then(() => closeAllPools())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('reset-demo failed:', err);
    await closeAllPools().catch(() => {});
    process.exit(1);
  });
