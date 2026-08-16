/**
 * The decisions behind `npm run flight:snapshot`, separated from the connection
 * so they can be tested with planted numbers instead of a live cluster.
 *
 * WHY THIS EXISTS. `docs/g1-sitting-sheet.md` opens with three pre-flight lines
 * a human is told to run before the card comes out. Two of them are commands.
 * The third reads "live `caregiver_leads` count — **0 rows** — the flight starts
 * from zero or N is contaminated from day one", and there was nothing to run.
 * The same sheet then says "then daily: `npm run verify:funnel` first, then the
 * snapshot table", and the snapshot table in `docs/g1-flight-log.md` wants a
 * lead count every day for four weeks.
 *
 * An obligation with no command is the shape this portfolio keeps losing things
 * in. Worse here than usual: the ratified read is DIRECTIONAL (`PROJECT.yaml`
 * `ratified.g1-flight-power` — the $250 ceiling buys N ≈ 100–180 against an
 * honest minimum of ~250), so a ship-or-kill call on the ratio alone is not
 * permitted for this flight, and lines 3 and 4 of the verdict — the lead count
 * and the lead notes, quoted — are expected to carry the decision. Those two
 * lines are read from this table and nowhere else.
 *
 * READ-ONLY BY CONSTRUCTION, and by privilege as well as by intent: the script
 * connects as whatever `.env.local` configures, which is the `relay_dev` role,
 * and `caregiver_leads` is the ONE table in the product that role cannot write
 * (sprint 5 AC2 — `S---` against `relay_app`'s `SIUD`). A stray write here is
 * refused by the database, not by a careful author.
 *
 * Feature: relay-g1-wtp
 */

/** One row of the daily snapshot table, as the flight log wants it. */
export interface SnapshotRow {
  date: string;
  leads: number;
  qualifiedLeadSrcs: string[];
}

/**
 * Has the measurement window opened?
 *
 * Read from `docs/g1-flight-log.md` rather than passed in, because that file
 * already holds the answer and a second place to record it is a second place to
 * be wrong. The row starts life as an italic instruction — "_fill on the day the
 * first ad is APPROVED and serving_" — and becomes a date when it happens.
 *
 * Anything still carrying "fill" is treated as not started. That is deliberately
 * the safe direction: an unstarted window ENFORCES the empty-table pre-flight,
 * so a misread costs a false alarm rather than a silent pass.
 */
export function windowStarted(flightLog: string): boolean {
  const row = flightLog.split(/\r?\n/).find((l) => /\|\s*\*\*Window start\*\*\s*\|/.test(l));
  if (!row) return false;
  const cell = row.split('|')[2] ?? '';
  if (/fill/i.test(cell)) return false;
  return /\d/.test(cell);
}

export interface PreFlightVerdict {
  ok: boolean;
  reason: string;
}

/**
 * The sitting sheet's line 3, as a check rather than a look.
 *
 * Before the window opens the table must be empty. Not tidiness: every row
 * present at the start is a lead the verdict cannot attribute to the flight,
 * and verdict line 3 is a COUNT of contactable humans. A leftover QA row from a
 * pre-flight walk reads at verdict time exactly like a stranger who wanted the
 * product.
 *
 * Once the window is open the count is reported and never judged — a growing
 * table is the thing being bought, and a script that failed on demand arriving
 * would be actively hostile.
 */
export function preFlightVerdict(args: { windowStarted: boolean; leads: number }): PreFlightVerdict {
  if (args.windowStarted) {
    return { ok: true, reason: `window is open — ${args.leads} lead(s) recorded so far` };
  }
  if (args.leads === 0) {
    return { ok: true, reason: 'window not started and caregiver_leads is empty — flight starts from zero' };
  }
  return {
    ok: false,
    reason:
      `window has NOT started and caregiver_leads holds ${args.leads} row(s). ` +
      `g1-sitting-sheet.md pre-flight line 3: the flight starts from zero or N is ` +
      `contaminated from day one. Clear them, or record each one as a known offset in ` +
      `g1-flight-log.md before the first ad serves.`,
  };
}

/** The daily row, in the column order `docs/g1-flight-log.md` uses. */
export function formatSnapshotRow(row: SnapshotRow): string {
  const srcs = row.qualifiedLeadSrcs.length ? row.qualifiedLeadSrcs.join(', ') : '—';
  return `| _(day)_ | ${row.date} | _(spend)_ | _(N — Vercel Analytics)_ | _(Lane-A)_ | _(Lane-B)_ | ${row.leads} | _(ratio)_ | leads from: ${srcs} |`;
}
