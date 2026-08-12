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
}

function pct(n: number, d: number): string {
  if (d === 0) return '   — ';
  return `${((n / d) * 100).toFixed(0).padStart(3)}%`;
}

async function main(): Promise<void> {
  const cohort = process.argv[2] ?? null;

  const res = await query<Row>(
    `SELECT coalesce(delivery_channel, 'unknown') AS delivery_channel,
            count(*)::text                                   AS issued,
            count(opened_at)::text                           AS opened,
            count(claimed_at)::text                          AS claimed
       FROM invitations
      WHERE ($1::text IS NULL OR cohort = $1)
      GROUP BY 1
      ORDER BY 1`,
    [cohort],
  );

  console.log(`\nPhase 0 — claim conversion${cohort ? ` (cohort: ${cohort})` : ' (all invitations)'}`);
  console.log('─'.repeat(64));
  console.log('channel        issued   opened   claimed   open%   claim%   of-opened%');
  console.log('─'.repeat(64));

  let ti = 0;
  let to = 0;
  let tc = 0;

  for (const r of res.rows) {
    const i = Number(r.issued);
    const o = Number(r.opened);
    const c = Number(r.claimed);
    ti += i;
    to += o;
    tc += c;
    console.log(
      `${r.delivery_channel.padEnd(13)} ${String(i).padStart(6)} ${String(o).padStart(8)} ` +
        `${String(c).padStart(9)} ${pct(o, i)}   ${pct(c, i)}      ${pct(c, o)}`,
    );
  }

  console.log('─'.repeat(64));
  console.log(
    `${'TOTAL'.padEnd(13)} ${String(ti).padStart(6)} ${String(to).padStart(8)} ` +
      `${String(tc).padStart(9)} ${pct(to, ti)}   ${pct(tc, ti)}      ${pct(tc, to)}`,
  );

  console.log(`
How to read this
  claim%       the headline. The architecture assumes contacts will claim.
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
