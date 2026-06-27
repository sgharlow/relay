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

const DEMO_EMAIL = 'demo@relay.test';

/** Delete every row owned by `ownerId` across all tables (no FKs in DSQL). */
async function wipeOwner(ownerId: string): Promise<void> {
  // verifier_confirmations is keyed by release_state_id, not owner_id — clear it
  // via the owner's release_state rows before those rows are deleted.
  await query(
    `DELETE FROM verifier_confirmations
      WHERE release_state_id IN (SELECT id FROM release_state WHERE owner_id = $1)`,
    [ownerId],
  );
  for (const table of [
    'audit_log',
    'access_rules',
    'release_state',
    'verifiers',
    'recipients',
    'vault_items',
  ]) {
    await query(`DELETE FROM ${table} WHERE owner_id = $1`, [ownerId]);
  }
  await query(`DELETE FROM users WHERE id = $1`, [ownerId]);
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
  // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.error('reset-demo failed:', err);
    await closeAllPools().catch(() => {});
    process.exit(1);
  });
