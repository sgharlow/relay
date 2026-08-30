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
 * unread. The next one at risk is the 2026-10-01 paywall revisit, which decides
 * whether a free tier can open a vault.
 *
 * ⚠️ ONLY BARE DATES ARE CHECKED, and that is deliberate rather than lazy. Most
 * `revisit:` values in this file are CONDITIONS — "at every /daily-priority from
 * 2026-09-01", "if G1 passes", "when g2-counsel-opinion is met". A condition has
 * no lapse date and inventing one for it would produce exactly the false alarm
 * that teaches an operator to ignore a guard. A bare `YYYY-MM-DD` is a promise
 * about a day; those are the ones that can quietly pass.
 *
 * ⚠️ AND IT DOES NOT DEMAND THE REVISIT WAS *DONE*. No test can know that. It
 * demands the date was ANSWERED — by recording an outcome, or by moving the date
 * with a reason. "Deferred again, here is why" is a legitimate answer and always
 * has been; silence is not. That is the register's own rule, applied to itself.
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

interface Lapsed {
  path: string;
  date: string;
  keys: string[];
}

/** `revisit:` values that are a bare date, with where they were found. */
function findRevisitDates(node: unknown, path: string, out: Lapsed[]): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => findRevisitDates(v, `${path}[${i}]`, out));
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  const here = typeof obj.id === 'string' ? `${path}(${obj.id})` : path;

  if ('revisit' in obj) {
    const v = obj.revisit;
    /*
      YAML parses an unquoted date as a Date. A quoted one, or prose, arrives as
      a string — and prose is a CONDITION, which this guard deliberately does not
      judge. `as_of` in this file carries a comment about exactly this parse.
    */
    let iso: string | null = null;
    if (v instanceof Date) iso = v.toISOString().slice(0, 10);
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) iso = v.trim();

    if (iso) out.push({ path: here, date: iso, keys: Object.keys(obj) });
  }

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'revisit') continue;
    findRevisitDates(v, `${here}.${k}`, out);
  }
}

const doc = parse(readFileSync('PROJECT.yaml', 'utf8')) as unknown;
const found: Lapsed[] = [];
findRevisitDates(doc, '', found);

/** UTC, so this test cannot mean different things on two machines. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('every revisit: date is answered, or has not arrived yet', () => {
  it('finds revisit dates at all, so this guard is not vacuous', () => {
    // If the field is renamed, this fails rather than silently passing on zero.
    expect(found.length, 'no bare-date revisit: found in PROJECT.yaml').toBeGreaterThan(0);
  });

  it('no revisit date has passed with nothing recorded against it', () => {
    const now = today();
    const unanswered = found
      .filter((f) => f.date < now)
      .filter((f) => !f.keys.some((k) => ACKNOWLEDGEMENT.test(k)));

    expect(
      unanswered.map((u) => `${u.path} — revisit: ${u.date}`),
      unanswered.length
        ? 'These revisit dates have passed and nothing in their entry records what happened:\n' +
          unanswered.map((u) => `  ${u.path}  revisit: ${u.date}`).join('\n') +
          '\n\nAnswer it, do not silence it. Either record the outcome — add a `revisited:` key ' +
          'saying what was decided — or MOVE the date and say why. "Deferred again, and here is ' +
          'the reason" is a legitimate answer; a date that simply passed is not. This guard was ' +
          'ruled on 2026-08-30 because the beta-cohort revisit lapsed unremarked and was ' +
          'recorded six days late.'
        : 'ok',
    ).toEqual([]);
  });

  it('does not judge a revisit expressed as a condition', () => {
    /*
      The discriminating case, asserted rather than trusted. Most revisit values
      here read "at every /daily-priority from 2026-09-01" or "if G1 passes".
      Those carry no lapse date, and a guard that treated the embedded date as a
      deadline would fire on entries that are behaving exactly as written — the
      false alarm that gets a check ignored.
    */
    const raw = readFileSync('PROJECT.yaml', 'utf8');
    const prose = (raw.match(/^\s+revisit:\s*["'>]/gm) ?? []).length;
    expect(prose, 'no prose revisit values found — the sample this rule is about has gone').toBeGreaterThan(0);
    // None of the prose ones may appear in the bare-date set.
    expect(found.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.date))).toBe(true);
  });
});
