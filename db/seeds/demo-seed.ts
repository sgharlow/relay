/**
 * Demo seed CLI — `npx tsx db/seeds/demo-seed.ts`.
 *
 * Inserts the demo dataset (one demo owner, 25 vault items, recipients,
 * verifiers, emergency/estate access rules, and ARMED release states). Requires
 * the DSQL env vars (see docs/aws-setup.md). The dataset + insert logic live in
 * lib/seed/ so they are unit-tested; this file is just the entry point.
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.1, 7.4
 */

import { seedDemo } from '../../lib/seed/seed-runner';

seedDemo()
  .then((r) => {
    // eslint-disable-next-line no-console
    console.log(
      `Seeded demo owner ${r.ownerId}: ${r.items} items, ${r.recipients} recipients, ` +
        `${r.verifiers} verifiers, ${r.rules} rules, ${r.releaseStates} release states.`,
    );
    process.exit(0);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Demo seed failed:', err);
    process.exit(1);
  });
