/**
 * How long ago the five live walks last ran, and when that becomes a problem.
 *
 * Pure logic, so the judgement is testable without a cluster, a server or a
 * clock — the same split `lib/g1/flight-snapshot.ts` uses against
 * `scripts/flight-snapshot.ts`.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the remembering half)
 */

/** Append-only, one JSON object per line, newest last. Tracked, so CI can read it. */
export const VERIFY_LIVE_LOG = 'docs/verify-live-runs.jsonl';

/**
 * 14 days, and the number is a judgement rather than a standard.
 *
 * Shorter and this fires during ordinary weeks when nobody is releasing, which
 * teaches everyone to ignore it — the failure mode that kills every alert. Longer
 * and a month of drift passes unremarked, which is what happened before this
 * existed. Two weeks is long enough that firing means something changed, short
 * enough that a release cannot be prepared on top of walks nobody has run since
 * the last one.
 *
 * ⚠️ It is deliberately NOT tied to `due:` dates or to a release cadence. This
 * measures whether the check is ALIVE, not whether a release is due.
 *
 * 🅿️ **RAISED TO 70 ON 2026-08-22 FOR A 60-DAY PARK, AND RESTORED TO 14 ON 2026-08-21 WHEN THE
 * PARK ENDED EARLY.** Steve resumed relay on 2026-08-21 — before the 2026-10-21 review, not at it —
 * so the raised threshold outlived its reason by the width of one session. It is restored here in
 * the same change that records the resumption in `PROJECT.yaml -> ratified.relay-resumed-2026-08-21`.
 *
 * ⚠️ **The lesson worth keeping is the shape, not the dates.** A threshold raised for a pause is
 * only honest while the pause is real; the raise and the resumption have to move together or the
 * alarm quietly measures nothing. The park entry said "RESTORE TO 14 WHEN THE PARK ENDS" and this
 * is that restoration — done in the resumption's own commit rather than left for whoever noticed.
 *
 * At 14 days and a newest stamp of 2026-08-21, the dead-man next fires ~2026-09-04. That is the
 * design working: it says run the chain, or record another pause with an owner and a date.
 */
export const STALE_AFTER_DAYS = 14;

export interface VerifyLiveRun {
  /** ISO-8601 UTC, written by the script at the moment the chain completed. */
  at: string;
  /** Short SHA the walks ran against — "green, but against what?" has an answer. */
  commit: string;
  branch: string;
  walks: string[];
}

export type Freshness =
  | { state: 'fresh'; last: VerifyLiveRun; ageDays: number }
  | { state: 'stale'; last: VerifyLiveRun; ageDays: number }
  | { state: 'never' }
  | { state: 'unreadable'; reason: string };

/**
 * Parse the log. Malformed input is `unreadable`, never silently `never` —
 * "the file is corrupt" and "nobody has ever run this" are different findings
 * with different fixes, and collapsing them is how a monitor lies.
 */
export function parseLog(contents: string): VerifyLiveRun[] | { error: string } {
  const lines = contents.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: VerifyLiveRun[] = [];

  for (const [i, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { error: `line ${i + 1} is not JSON` };
    }
    const r = parsed as Partial<VerifyLiveRun>;
    if (typeof r?.at !== 'string' || Number.isNaN(Date.parse(r.at))) {
      return { error: `line ${i + 1} has no usable \`at\` timestamp` };
    }
    if (typeof r.commit !== 'string' || !r.commit) {
      return { error: `line ${i + 1} records no commit` };
    }
    out.push({ at: r.at, commit: r.commit, branch: String(r.branch ?? ''), walks: r.walks ?? [] });
  }
  return out;
}

/** The newest entry decides, whatever order the file happens to be in. */
export function assess(
  contents: string | null,
  now: Date,
  staleAfterDays = STALE_AFTER_DAYS,
): Freshness {
  if (contents === null) return { state: 'never' };

  const parsed = parseLog(contents);
  if ('error' in parsed) return { state: 'unreadable', reason: parsed.error };
  if (!parsed.length) return { state: 'never' };

  const last = parsed.reduce((a, b) => (Date.parse(a.at) >= Date.parse(b.at) ? a : b));
  const ageDays = (now.getTime() - Date.parse(last.at)) / 86_400_000;

  /*
    A future timestamp is not fresh. It is a clock that is wrong or a stamp that
    was written by hand — both of which mean the log cannot be trusted to say
    anything, and treating it as maximally fresh would be the log's own worst
    possible failure.
  */
  if (ageDays < -1) return { state: 'unreadable', reason: `newest run is dated in the future (${last.at})` };

  return { state: ageDays > staleAfterDays ? 'stale' : 'fresh', last, ageDays };
}

/** The message the test prints. Written here so it is covered by tests too. */
export function explain(f: Freshness, staleAfterDays = STALE_AFTER_DAYS): string {
  switch (f.state) {
    case 'fresh':
      return `verify:live last ran ${f.ageDays.toFixed(1)} days ago @ ${f.last.commit}`;
    case 'never':
      return (
        `No verify:live run has ever been recorded in ${VERIFY_LIVE_LOG}.\n\n` +
        'The five walks are the half of the release gate a unit suite cannot see — ' +
        'D1\'s fail-closed boundary broke two of them while `npm run gate` stayed green. ' +
        'Run `npm run verify:live` (needs .env.local and `npm run dev`); the chain stamps ' +
        'this file itself when every walk passes.'
      );
    case 'unreadable':
      return (
        `${VERIFY_LIVE_LOG} cannot be trusted: ${f.reason}.\n\n` +
        'This is append-only and is written by scripts/stamp-verify-live.ts. If it was ' +
        'hand-edited, the honest fix is to remove the bad line rather than to correct it — ' +
        'a stamp nobody executed records intent, and intent was already being recorded while ' +
        'the walks went unrun.'
      );
    case 'stale':
      return (
        `verify:live has not run for ${f.ageDays.toFixed(1)} days ` +
        `(threshold ${staleAfterDays}); last run ${f.last.at} @ ${f.last.commit}.\n\n` +
        'This test is doing its job, not failing. The walks drive the running app against the ' +
        'production cluster and catch what the unit suite structurally cannot. Two honest fixes:\n' +
        '  1. Run `npm run verify:live` — it stamps the log itself on success, and this goes green.\n' +
        '  2. If the walks are deliberately paused, record that decision in PROJECT.yaml with an ' +
        'owner and a date, and raise STALE_AFTER_DAYS in the same commit so the number matches ' +
        'the decision.\n\n' +
        'What this exists to prevent is the third option, which is nobody noticing.'
      );
  }
}
