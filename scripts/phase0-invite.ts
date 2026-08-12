/**
 * Phase 0 — issue an invitation with the delivery arm recorded.
 *
 * The measurement only means something if the cohort is SPLIT. Half the people
 * get the code by email (the channel we know is unreliable), half get it however
 * you would actually reach them — read down the phone, texted, handed over. If
 * the owner-delivered arm converts and the email arm does not, the problem is the
 * channel rather than the ask, and that is the difference between a delivery bug
 * and a dead architecture.
 *
 * This prints the code and does NOT send anything, on purpose. For the owner arm
 * there is nothing to send; for the email arm, sending is a separate deliberate
 * act. A script that quietly emailed people would also make the arms
 * incomparable.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/phase0-invite.ts <ownerEmail> <personEmail> <email|owner> [cohort]
 *
 * The person must already exist on the owner's roster — this issues a code for
 * somebody they have named, it does not create relationships.
 */

import { query, closeAllPools } from '../lib/db/connection';
import { createInvitation, formatInviteCode } from '../lib/people/invitations';

async function main(): Promise<void> {
  const [ownerEmail, personEmail, channel, cohort = 'phase0'] = process.argv.slice(2);

  if (!ownerEmail || !personEmail || (channel !== 'email' && channel !== 'owner')) {
    console.log(
      'usage: phase0-invite.ts <ownerEmail> <personEmail> <email|owner> [cohort]\n' +
        '  email — you will send the code by email (the arm under test)\n' +
        '  owner — you will deliver it yourself: phone, text, in person',
    );
    await closeAllPools();
    return;
  }

  const owner = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
    ownerEmail,
  ]);
  const ownerId = owner.rows[0]?.id;
  if (!ownerId) {
    console.error(`No owner with email ${ownerEmail}`);
    process.exit(1);
  }

  // Look in both roster tables — the person may be either role.
  const person = await query<{ id: string; name: string; kind: string }>(
    `SELECT id, name, 'recipient' AS kind FROM recipients WHERE owner_id = $1 AND email = $2
     UNION ALL
     SELECT id, name, 'verifier'  AS kind FROM verifiers  WHERE owner_id = $1 AND email = $2
     LIMIT 1`,
    [ownerId, personEmail],
  );
  const row = person.rows[0];
  if (!row) {
    console.error(`${personEmail} is not on that owner's roster. Add them first.`);
    process.exit(1);
  }

  const { token, expiresAt } = await createInvitation(ownerId, {
    personId: row.id,
    personType: row.kind as 'recipient' | 'verifier',
    deliveryChannel: channel,
    cohort,
  });

  console.log(`
  person   ${row.name} (${row.kind})
  channel  ${channel}${channel === 'owner' ? '  — read it to them, do not email it' : '  — send by email'}
  cohort   ${cohort}
  expires  ${expiresAt}

  CODE     ${formatInviteCode(token)}

  They enter it at https://relaystandby.com/claim
  Nothing has been sent. Delivering it is your step, and which arm this lands in
  depends on you actually using the channel above.
`);

  await closeAllPools();
}

main().catch((err) => {
  console.error('[phase0] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
