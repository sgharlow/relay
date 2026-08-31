/**
 * A `revisit:` date that passes with nothing recorded against it fails here.
 *
 * 🔴 RULED 2026-08-30 (Sitting D-1, A0.dm / E4.4). The evidence is a mechanism
 * failure, not a one-off: the beta-cohort `revisit: 2026-08-23` LAPSED
 * unremarked and was recorded six days late — the third deferral of that item
 * and the first one nobody made. Nothing in this repository read `revisit:`.
 * Dates were written down carefully and then passed.
 *
 * The alternative offered at the sitting was promoting that one item to a dated
 * `gates:` entry, which `gates.test.ts` already watches. It was declined for the
 * reason this file exists: that fixes ONE date and leaves every other `revisit:`
 * unread.
 *
 * ⚠️ AND IT DOES NOT DEMAND THE REVISIT WAS *DONE*. No test can know that. It
 * demands the date was ANSWERED — by recording an outcome, or by moving the date
 * with a reason. "Deferred again, here is why" is a legitimate answer and always
 * has been; silence is not. That is the register's own rule, applied to itself.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 E4.4, 2026-08-30 — THE FIRST VERSION OF THIS FILE NAMED THE PAYWALL REVISIT
 * AS THE THING IT PROTECTED AND COULD NOT SEE IT.
 *
 * Its header said "the next one at risk is the 2026-10-01 paywall revisit", and
 * its rule was BARE DATES ONLY, argued this way:
 *
 *   "Most revisit: values in this file are CONDITIONS — 'at every /daily-priority
 *    from 2026-09-01', 'if G1 passes'. A condition has no lapse date and inventing
 *    one for it would produce exactly the false alarm that teaches an operator to
 *    ignore a guard."
 *
 * `ratified.beta-free-release.revisit` is *"at every /daily-priority from
 * 2026-10-01"*. So the one entry the guard was built for was swept into the class
 * it deliberately refused to judge, in the same comment. The register recorded
 * `a0_dm_revisit_guard.covers_next: "The 2026-10-01 paywall revisit"` — a claim
 * that was false the moment it was written.
 *
 * ⚠️ AND THE ARGUMENT IT WAS FALSE ABOUT IS STILL CORRECT, which is why the fix
 * is not "judge the embedded date". `g3-b2b2c-pilot-loi` also reads "from
 * 2026-09-01" and is owed nothing on that day: its outcome is owed at
 * `due: 2026-11-30`, and `gates.test.ts` already watches that. Firing on 09-01
 * would be precisely the false alarm the old comment predicted.
 *
 * The real distinction is not cadence-vs-date. It is whether an OUTCOME IS OWED
 * at the cadence's first occurrence — and prose cannot be asked that question, so
 * THE ENTRY MUST DECLARE IT. A dated cadence must now classify itself as one of:
 *
 *   `superseded_by:`  a stopped clock — the B30 convention, already asserted by
 *                     `gates.test.ts` to resolve to a real live gate
 *   `decision_due:`   a bare date on which an outcome is owed — judged here
 *   `cadence_only:`   a re-raise with the outcome dated elsewhere, plus the reason
 *
 * Anything else fails. A dated cadence cannot be written without saying which it
 * is, which is the forcing function the first version lacked.
 *
 * WHY THE PAYWALL IS THE ONE THAT NEEDED THIS: a `gates:` entry carries `due:`
 * and is watched. `ratified.beta-free-release` is a ratified decision — it has no
 * `due:`, no gate, and no dated instrument anywhere in the repository. Its prose
 * cadence was the only record that a decision was owed, and prose is not read by
 * anything. That is the whole of the hole, and it sits under the flag that
 * decides whether a free tier can open a vault.
 *
 * Feature: relay-h0-mvp
 * Requirements: A0.dm, E4.4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/**
 * Keys that count as answering a lapsed date.
 *
 * `revisited` / `revisit_outcome` are the CANONICAL forms — use one of those for
 * anything new. The dated-suffix pattern is accepted because the register
 * already uses it (`third_deferral_recorded_2026_08_29`), and a guard that
 * rejected the existing convention on its first run would be asking the
 * repository to change to suit the checker.
 */
const ACKNOWLEDGEMENT = /^(revisited|revisit_outcome|revisit_answered)$|_recorded_\d{4}_\d{2}_\d{2}$/;

/** A bare `YYYY-MM-DD`, the only shape this guard will judge as a deadline. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date the cadence is ANCHORED TO — "at every /daily-priority from 2026-10-01".
 *
 * ⚠️ NOT every date the value mentions, and the first draft of this rule made
 * exactly that mistake. `ratified.beta-cohort-deferred` reads *"at the next
 * /daily-priority … this one has now been ready-and-unstarted **since
 * 2026-08-12**"*. That date is history, not a trigger: the cadence is "the next
 * /daily-priority" and fires whenever that happens. A bare date-match demanded
 * that entry classify itself and would have gone on demanding it of every future
 * entry that mentions a date while explaining itself — the false alarm this
 * file's own comments predict two paragraphs above, produced by the fix for it.
 *
 * So the date must be governed by a preposition that makes it the anchor.
 * "since" is deliberately absent from that list.
 */
const DATE_IN_PROSE = /\b(?:from|on|after|starting|by|not before|no earlier than)\s+(\d{4}-\d{2}-\d{2})\b/i;

/**
 * A `cadence_only:` reason shorter than this is decoration.
 *
 * The same bar every allowlist in `lib/ops/` uses: a justification that cannot be
 * falsified is not a justification. "not needed" passes no review; "the outcome
 * is owed at the gate's own due: 2026-11-30, watched by gates.test.ts" can be
 * checked by reading it.
 */
const MIN_REASON = 40;

interface Judged {
  path: string;
  date: string;
  keys: string[];
  /** Which field supplied the date — for the failure message. */
  via: 'revisit' | 'decision_due';
}

interface Unclassified {
  path: string;
  value: string;
  date: string;
}

const judged: Judged[] = [];
const unclassified: Unclassified[] = [];
/** Dated cadences that classified themselves, so the exemption is not silent. */
const exempt: { path: string; how: string }[] = [];

function classify(obj: Record<string, unknown>, here: string): void {
  const v = obj.revisit;
  const keys = Object.keys(obj);

  /*
    YAML parses an unquoted date as a Date. A quoted one, or prose, arrives as a
    string — and prose is where the interesting case lives.
  */
  if (v instanceof Date) {
    judged.push({ path: here, date: v.toISOString().slice(0, 10), keys, via: 'revisit' });
    return;
  }
  if (typeof v !== 'string') return;

  const text = v.trim();
  if (BARE_DATE.test(text)) {
    judged.push({ path: here, date: text, keys, via: 'revisit' });
    return;
  }

  const inProse = DATE_IN_PROSE.exec(text);
  if (!inProse) return; // a genuine condition — "if G1 passes". Not judged, by design.

  // ── a DATED CADENCE. It must say whether an outcome is owed. ──────────────
  if (typeof obj.superseded_by === 'string' && obj.superseded_by.trim().length > 0) {
    exempt.push({ path: here, how: `superseded_by: ${obj.superseded_by}` });
    return;
  }

  const due = obj.decision_due;
  const dueIso =
    due instanceof Date
      ? due.toISOString().slice(0, 10)
      : typeof due === 'string'
        ? due.trim()
        : null;
  if (dueIso && BARE_DATE.test(dueIso)) {
    judged.push({ path: here, date: dueIso, keys, via: 'decision_due' });
    return;
  }

  if (typeof obj.cadence_only === 'string' && obj.cadence_only.trim().length >= MIN_REASON) {
    exempt.push({ path: here, how: 'cadence_only' });
    return;
  }

  unclassified.push({
    path: here,
    value: text.replace(/\s+/g, ' ').slice(0, 100),
    date: inProse[1],
  });
}

function walk(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`));
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  const here = typeof obj.id === 'string' ? `${path}(${obj.id})` : path;

  if ('revisit' in obj) classify(obj, here);

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'revisit') continue;
    walk(v, `${here}.${k}`);
  }
}

const doc = parse(readFileSync('PROJECT.yaml', 'utf8')) as unknown;
walk(doc, '');

/** UTC, so this test cannot mean different things on two machines. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('every revisit: date is answered, or has not arrived yet', () => {
  it('finds revisit dates at all, so this guard is not vacuous', () => {
    // If the field is renamed, this fails rather than silently passing on zero.
    expect(judged.length, 'no judgeable revisit date found in PROJECT.yaml').toBeGreaterThan(0);
  });

  it('no revisit date has passed with nothing recorded against it', () => {
    const now = today();
    const unanswered = judged
      .filter((f) => f.date < now)
      .filter((f) => !f.keys.some((k) => ACKNOWLEDGEMENT.test(k)));

    expect(
      unanswered.map((u) => `${u.path} — ${u.via}: ${u.date}`),
      unanswered.length
        ? 'These dates have passed and nothing in their entry records what happened:\n' +
            unanswered.map((u) => `  ${u.path}  ${u.via}: ${u.date}`).join('\n') +
            '\n\nAnswer it, do not silence it. Either record the outcome — add a `revisited:` key ' +
            'saying what was decided — or MOVE the date and say why. "Deferred again, and here is ' +
            'the reason" is a legitimate answer; a date that simply passed is not. This guard was ' +
            'ruled on 2026-08-30 because the beta-cohort revisit lapsed unremarked and was ' +
            'recorded six days late.'
        : 'ok',
    ).toEqual([]);
  });

  it('a dated cadence classifies itself — an outcome is owed, or it is not', () => {
    /*
      🔴 THE E4.4 RULE. "at every /daily-priority from 2026-10-01" is not a
      condition and not a deadline; it is a cadence with a start. Whether an
      OUTCOME falls due at that start is a fact about the entry that no amount of
      reading its prose will settle, so the entry declares it.

      This is what makes the guard non-vacuous for the case it was built for.
      Without it a dated cadence is judged by nothing, and `beta-free-release` —
      which has no `due:`, no gate and no other dated instrument anywhere — was
      exactly that.
    */
    expect(
      unclassified.map((u) => `${u.path} — "${u.value}"`),
      unclassified.length
        ? 'These `revisit:` values name a date but do not say whether an outcome is owed on it:\n' +
            unclassified.map((u) => `  ${u.path}\n    "${u.value}"  (date: ${u.date})`).join('\n') +
            '\n\nAdd exactly one of:\n' +
            '  decision_due: YYYY-MM-DD   an outcome IS owed then — this guard will judge it\n' +
            `  cadence_only: "<reason>"   a re-raise; say where the outcome is dated instead (>= ${MIN_REASON} chars)\n` +
            '  superseded_by: <gate-id>   a stopped clock; gates.test.ts asserts it resolves\n\n' +
            'A dated cadence that classifies itself as nothing is how the 2026-10-01 paywall ' +
            'revisit came to be named in this file own header as the thing it protected, while ' +
            'being invisible to it.'
        : 'ok',
    ).toEqual([]);
  });

  it('does not judge a revisit expressed as a condition', () => {
    /*
      The discriminating case, asserted rather than trusted, and still correct
      after E4.4. "if G1 passes" and "when g2-counsel-opinion is met" carry no
      date at all — a guard that invented one would fire on entries behaving
      exactly as written, which is the false alarm that gets a check ignored.

      Note what changed and what did not: prose is still not judged. What IS
      judged is a date the entry has declared to be a deadline.
    */
    const raw = readFileSync('PROJECT.yaml', 'utf8');
    const prose = (raw.match(/^\s+revisit:\s*["'>]/gm) ?? []).length;
    expect(
      prose,
      'no prose revisit values found — the sample this rule is about has gone',
    ).toBeGreaterThan(0);
    expect(judged.every((f) => BARE_DATE.test(f.date))).toBe(true);
  });

  it('the paywall revisit is one of the dates this guard judges', () => {
    /*
      🔴 THE REGRESSION TEST FOR THIS FILE'S OWN FAILURE, named rather than
      implied. `ratified.beta-free-release` is the entry the guard was built for
      and the entry it could not see. If it ever falls out of the judged set — by
      losing `decision_due:`, by the field being renamed, by the walker changing
      shape — that is the original defect returning, and it must fail here rather
      than be noticed by a person in October.
    */
    const paywall = judged.find((j) => j.path.includes('beta-free-release'));
    expect(
      paywall,
      'ratified.beta-free-release is no longer judged by this guard. That is the exact ' +
        'defect E4.4 was opened for: the paywall decision has no `due:`, no gate and no other ' +
        'dated instrument in this repository, so if this guard does not judge it, nothing does.',
    ).toBeTruthy();
    expect(paywall!.via).toBe('decision_due');
    expect(paywall!.date).toBe('2026-10-01');
  });

  it('a date the cadence merely MENTIONS is not treated as its anchor', () => {
    /*
      🔴 THE FALSE ALARM THIS RULE ALMOST SHIPPED WITH, pinned to the live entry
      that produced it. `ratified.beta-cohort-deferred` fires at "the next
      /daily-priority" and explains itself with "…ready-and-unstarted since
      2026-08-12". The first draft matched any date and demanded that entry
      classify itself, which is the behaviour the E4.4 note above calls the thing
      that teaches an operator to ignore a guard.

      Asserted on the real value rather than a fixture, so it stays true only
      while the register really does still contain the shape.
    */
    const raw = readFileSync('PROJECT.yaml', 'utf8');
    expect(
      /ready-and-unstarted since\s+\d{4}-\d{2}-\d{2}/.test(raw),
      'the "since <date>" sample this rule discriminates on has gone from PROJECT.yaml — ' +
        'find the current incidental-date shape and pin that instead, or this test is vacuous',
    ).toBe(true);
    expect(
      unclassified.concat(judged.map((j) => ({ path: j.path, value: '', date: j.date })) as never[])
        .map((u) => u.path)
        .filter((p) => p.includes('beta-cohort-deferred)')),
      'ratified.beta-cohort-deferred is anchored to "the next /daily-priority", not to a date. ' +
        'It must be judged by nothing and demanded of nothing.',
    ).toEqual([]);
  });

  it('every exemption is recorded, so none of them is silent', () => {
    // A dated cadence that opted out did so by name. Zero would mean the
    // classification branch is unreachable and the rule above is decoration.
    expect(
      exempt.length,
      'no dated cadence took an exemption — the branch is untested by the data',
    ).toBeGreaterThan(0);
    for (const e of exempt) expect(e.how.length).toBeGreaterThan(0);
  });
});
