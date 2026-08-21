/**
 * The sentence the vault screen shows after an analysis run.
 *
 * 🔴 IT USED TO REPORT A CAPPED RUN AS A COMPLETE ONE, and the number that would
 * have said otherwise existed the whole time. `runIntake` scores at most 300
 * items in a run (Req 11.10) and returns the remainder as `remaining`;
 * `/api/ai/intake` dropped that key, and this screen read only `scored`. So an
 * owner with 312 accounts read "Looked at 300 items and re-ordered them by what
 * matters most" — a complete-sounding report of a partial run, on the screen
 * whose whole claim is that the order means something.
 *
 * Extracted from `VaultDashboardClient` rather than left inline so the wording
 * is testable: the component is a `.tsx` in a `node` test environment, where a
 * template literal inside JSX can only be checked by reading the file as text.
 *
 * ⚠️ NO PROMISE ABOUT A NEXT RUN, EVER. `importance_score` is NOT NULL DEFAULT
 * 0.5, so there is no marker distinguishing "never scored" from "scored 0.5",
 * and every run therefore starts from the same place — the items past the cap
 * are not queued for anything. "We will get to the rest next time" would be the
 * same misreport in a kinder register. Adding that marker is a migration, which
 * is a sysadmin act and lands separately from this code.
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.9, 11.10
 */

export interface AnalysisOutcome {
  /** Items this run classified and wrote back. */
  scored: number;
  /** What the batch cap left behind. Absent on a deploy that predates the key. */
  remaining: number | undefined;
  /** How many items fell back to the default classification (Req 11.9). */
  warnings: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function summariseAnalysis({ scored, remaining, warnings }: AnalysisOutcome): string {
  if (scored === 0) return 'Nothing to analyse yet — add an account first.';

  let out = `Looked at ${plural(scored, 'item')} and re-ordered them by what matters most.`;

  // The cap, named plainly. "Other" rather than "more" because they are not
  // waiting in a queue — see the header.
  if (remaining && remaining > 0) {
    out +=
      ` ${plural(remaining, 'other item')} ${remaining === 1 ? 'was' : 'were'} not looked at:` +
      ' an analysis covers a fixed number at a time and starts from the same place each run,' +
      ' so running it again will not reach them.';
  }

  // A different event from the cap, and reported separately for that reason: the
  // cap means an item was never seen, this means one was seen and could not be
  // classified.
  if (warnings > 0) out += ` ${warnings} could not be scored.`;

  return out;
}
