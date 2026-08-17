/**
 * Phase 0 — claim conversion, read as a funnel.
 *
 * The architecture bets everything on whether named contacts will claim a standby
 * account (docs/standby-architecture.md risk 1). This prints the number that
 * decides it, split so it can actually be interpreted.
 *
 * WHY THE SPLIT MATTERS. The invitation used to ride the channel measured broken
 * on 2026-08-11 — Outlook filing us at SCL 5, Resend suppression returning 200 on
 * a muted recipient. Without a comparison arm, a low conversion number cannot
 * distinguish "people will not claim" from "the invitation never arrived", and
 * those have opposite consequences: the first kills the architecture, the second
 * is a delivery bug the architecture already routes around.
 *
 * So: invite half by email and half by whatever channel you would actually use —
 * read it down the phone, text it, hand it over. If the owner-delivered arm
 * converts and the email arm does not, the problem is the channel.
 *
 * Committed rather than kept as a scratch file, because a runbook that references
 * a gitignored script is a runbook that fails on the second machine.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/phase0-report.ts [cohort]
 */

import { query, closeAllPools } from '../lib/db/connection';

interface Row {
  /** Non-null: the SQL coalesces it, so 'unknown' stands in for a legacy row. */
  delivery_channel: string;
  issued: string;
  opened: string;
  claimed: string;
  /** Claimed, then stepped down. Counted in `claimed` too — subtract for the honest figure. */
  resigned: string;
}

function pct(n: number, d: number): string {
  if (d === 0) return '   — ';
  return `${((n / d) * 100).toFixed(0).padStart(3)}%`;
}

async function main(): Promise<void> {
  const cohort = process.argv[2] ?? null;

  const res = await query<Row>(
    /*
      🔴 `count(claimed_at)` ALONE OVERSTATES THE NUMBER THIS REPORT EXISTS FOR.

      Stepping down (lib/people/resign.ts, POST /api/standby/leave) nulls
      `claimed_user_id` on the PERSON row and returns them to `standby_state =
      'invited'`. It deliberately does not touch the invitation — "DEGRADE, NEVER
      DELETE" — so `claimed_at` stays set forever and the resigner kept counting
      as a successful claim.

      That error runs in the OPTIMISTIC direction, which is the dangerous one
      here. The threshold below is a floor: below ~50% the fallback path carries
      more traffic than the primary one and the ranking swings back toward
      durable artifacts. An inflated numerator hides a breach of that floor.

      It matters beyond the funnel, too. Principle 1 of the standby architecture
      is conditional on claim conversion, and adaptive minting assumes verifiers
      actually reach `confirmed`. Both need people who are STILL THERE, not
      people who once tapped a link.

      A resigner is detected precisely rather than inferred: the invitation has
      `claimed_at`, and the person row is unbound. Somebody who never claimed has
      no `claimed_at`, so the two cannot be confused.

      Fixed 2026-08-17, while N is still 0 — after real data exists the two
      populations cannot be separated retroactively, because nothing records the
      moment a claim was undone.
    */
    `SELECT coalesce(i.delivery_channel, 'unknown') AS delivery_channel,
            count(*)::text                                   AS issued,
            count(i.opened_at)::text                         AS opened,
            count(i.claimed_at)::text                        AS claimed,
            count(*) FILTER (
              WHERE i.claimed_at IS NOT NULL
                AND coalesce(r.claimed_user_id, v.claimed_user_id) IS NULL
            )::text                                          AS resigned
       FROM invitations i
       LEFT JOIN recipients r ON i.person_type = 'recipient' AND r.id = i.person_id
       LEFT JOIN verifiers  v ON i.person_type = 'verifier'  AND v.id = i.person_id
      WHERE ($1::text IS NULL OR i.cohort = $1)
      GROUP BY 1
      ORDER BY 1`,
    [cohort],
  );

  console.log(`\nPhase 0 — claim conversion${cohort ? ` (cohort: ${cohort})` : ' (all invitations)'}`);
  console.log('─'.repeat(64));
  console.log('channel        issued   opened   claimed  steppedD   open%   claim%   of-opened%');
  console.log('─'.repeat(64));

  let ti = 0;
  let to = 0;
  let tc = 0;
  let tr = 0;

  for (const r of res.rows) {
    const i = Number(r.issued);
    const o = Number(r.opened);
    const c = Number(r.claimed);
    const g = Number(r.resigned);
    // The honest numerator: claimed AND still standing. `claimed` keeps the
    // gross figure so a resignation is visible rather than silently netted away.
    const net = c - g;
    ti += i;
    to += o;
    tc += c;
    tr += g;
    console.log(
      `${r.delivery_channel.padEnd(13)} ${String(i).padStart(6)} ${String(o).padStart(8)} ` +
        `${String(c).padStart(9)} ${String(g).padStart(9)} ${pct(o, i)}   ${pct(net, i)}      ${pct(net, o)}`,
    );
  }

  console.log('─'.repeat(64));
  const netTotal = tc - tr;
  console.log(
    `${'TOTAL'.padEnd(13)} ${String(ti).padStart(6)} ${String(to).padStart(8)} ` +
      `${String(tc).padStart(9)} ${String(tr).padStart(9)} ${pct(to, ti)}   ${pct(netTotal, ti)}      ${pct(netTotal, to)}`,
  );
  if (tr > 0) {
    console.log(
      `
⚠️  ${tr} of the ${tc} claim(s) stepped down afterwards. claim% above is NET of those —
` +
        `    they claimed, so the funnel worked, but they are not there at release time and the
` +
        `    architecture's principle 1 needs people who are.`,
    );
  }

  console.log(`
How to read this
  claim%       the headline, NET of people who stepped down afterwards.
  steppedD     claimed, then used "Step down from this". Counted inside claimed
               and subtracted from claim% — the funnel worked for them, but they
               are not standing by, and principle 1 needs people who are.
  open%        did the code REACH them? A low open% on the email arm is a
               delivery problem, not a demand problem.
  of-opened%   of the people who saw the page, how many finished? This is the
               only number that measures the ASK rather than the channel.

The threshold, restated from the sprint plan so it cannot be moved after seeing
the result: below roughly 50% the fallback path carries more traffic than the
primary one, the surface and distribution arguments collapse, and the ranking
swings back toward durable artifacts. Decide against that line, not against
whatever this prints.

⚠️  N matters. Twenty invitations is a directional read, not a decisive one — the
    same limitation ratified for G1. Do not write a kill decision off a handful.
`);

  await closeAllPools();
}

main().catch((err) => {
  console.error('[phase0] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
