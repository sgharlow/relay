/**
 * How long ago the three journey walks last ran, and when that becomes a problem.
 *
 * The sibling of `verify-live-freshness.ts`, for the OTHER chain. It deliberately
 * reuses that module's `parseLog` and `assess` rather than restating them: the
 * judgement about what a log means — corrupt is not `never`, a future stamp is
 * not fresh, the newest entry decides — is one contract, and a second copy of it
 * is a second thing to get wrong. What differs per chain is the log it reads, the
 * threshold it holds, and the prose it prints, because the honest fixes differ.
 *
 * WHY THIS EXISTS AT ALL (B14). D10 — the journey sweep — was closed on
 * 2026-08-21 by BUILDING `npm run verify:journeys`: three walks covering J3
 * (assisted setup + consent), J6 (access request, challenge, cooling-off) and J9
 * (stand down and re-arm). Nothing schedules them and nothing ages them. So the
 * register recorded a gap as closed, and the thing that closed it was free to
 * stop running from the day after without producing a single failure to notice.
 * That is precisely the shape `verify-live-freshness.ts` was written for, in the
 * same repo, two days earlier — and the second chain shipped without it.
 *
 * The portfolio rule underneath both: a check whose success signal is a side
 * effect must have the ABSENCE of that signal monitored, because a job that never
 * runs produces no failure to alert on.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the remembering half); B14
 */

import { assess, type Freshness, type VerifyLiveRun } from './verify-live-freshness';

/** Append-only, one JSON object per line, newest last. Tracked, so CI can read it. */
export const VERIFY_JOURNEYS_LOG = 'docs/verify-journeys-runs.jsonl';

/**
 * 21 days, and the difference from `verify:live`'s 14 is deliberate rather than
 * an oversight — it is the signup ceiling, written down as a number.
 *
 * The two chains cannot share an hour. `/api/auth/signup` allows 10 per hour per
 * client key; `verify:live` performs exactly 10 and this chain performs 5 more,
 * so running both means either an hour apart or a dev-server restart between
 * them. A threshold that demanded this chain at the same cadence as the other
 * would be demanding a two-part sitting every fortnight, and a gate that is
 * expensive to satisfy is a gate that gets a raised threshold instead of a run.
 *
 * These walks also cover slower-moving ground. `verify:live` guards the crypto
 * and release paths that change most weeks; J3/J6/J9 cover consent, access
 * requests and stand-down, where a month can pass with no commit touching them.
 *
 * ⚠️ Longer is not free, and the reason to keep it under a month is concrete:
 * two of this chain's assertions are written to go RED when a defect is FIXED
 * (the approve-before-first-rule finding, `deferred → approve-is-unreachable-
 * before-the-first-rule`). A chain that has not run since before a fix is a
 * chain whose next run reports a stale finding as a live one.
 *
 * If this is raised, raise it in the same commit as the decision that justifies
 * it, with an owner and a date — the mistake `STALE_AFTER_DAYS` recorded against
 * itself when a 60-day park's raise outlived the park by a session.
 */
export const JOURNEYS_STALE_AFTER_DAYS = 21;

/** Same row shape as the live log; `walks` names the three that ran. */
export type VerifyJourneysRun = VerifyLiveRun;

/** Assess the journeys log against this chain's own threshold. */
export function assessJourneys(contents: string | null, now: Date): Freshness {
  return assess(contents, now, JOURNEYS_STALE_AFTER_DAYS);
}

/**
 * The message the test prints. The prose is this chain's own because the fixes
 * are: a different command, a different credential need, and one trap that
 * belongs to no other chain.
 */
export function explainJourneys(f: Freshness): string {
  const run =
    'Run `npm run verify:journeys` (needs .env.local and `npm run dev`). It performs 5 signups ' +
    'against a 10-per-hour-per-IP limiter that `npm run verify:live` fills entirely, so run the ' +
    'two an HOUR APART or restart the dev server between them. The chain stamps this file itself ' +
    'when all three walks pass.';

  switch (f.state) {
    case 'fresh':
      return `verify:journeys last ran ${f.ageDays.toFixed(1)} days ago @ ${f.last.commit}`;
    case 'never':
      return (
        `No verify:journeys run has ever been recorded in ${VERIFY_JOURNEYS_LOG}.\n\n` +
        'These are the three walks that closed D10 — J3 (assisted setup and consent), J6 (access ' +
        'request, owner challenge, cooling-off) and J9 (stand down and re-arm). Before they ' +
        'existed those journeys had NO automated cover at all, and the register was closed on ' +
        'their construction rather than on a run.\n\n' +
        run
      );
    case 'unreadable':
      return (
        `${VERIFY_JOURNEYS_LOG} cannot be trusted: ${f.reason}.\n\n` +
        'This is append-only and is written by scripts/stamp-verify-journeys.ts. If it was ' +
        'hand-edited, the honest fix is to remove the bad line rather than to correct it — a ' +
        'stamp nobody executed records intent, and this whole file exists because a chain was ' +
        'recorded as closed on the strength of intent.'
      );
    case 'stale':
      return (
        `verify:journeys has not run for ${f.ageDays.toFixed(1)} days ` +
        `(threshold ${JOURNEYS_STALE_AFTER_DAYS}); last run ${f.last.at} @ ${f.last.commit}.\n\n` +
        'This test is doing its job, not failing. Two honest fixes:\n' +
        `  1. ${run}\n` +
        '  2. If the walks are deliberately paused, record that decision in PROJECT.yaml with an ' +
        'owner and a date, and raise JOURNEYS_STALE_AFTER_DAYS in the same commit so the number ' +
        'matches the decision.\n\n' +
        '⚠️ Read the run\'s output rather than only its exit code: two assertions in this chain ' +
        'are written to go RED when the approve-before-first-rule defect is FIXED. After a long ' +
        'gap that is the likeliest thing to fire, and it is the record working, not a broken walk.'
      );
  }
}
