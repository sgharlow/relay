/**
 * The verifier's timeline says something in English for every event it can show.
 *
 * 🔴 THE DEFECT THIS GENERALISES. `VerifyClient.tsx` mapped
 * `checkin_reminder_sent` to "We tried to reach them" and
 * `lib/release/verifier-context.ts` filtered its audit read on the same string.
 * Nothing writes it — the ladder writes `owner_checkin_reminder_first` and
 * `_final` — so the two files agreed with each other and disagreed with the
 * database, and the row was simply never rendered. Two files holding the same
 * wrong constant look exactly like two files holding the right one.
 *
 * ⚠️ SO THIS CHECKS BOTH DIRECTIONS, and the second is the one that would have
 * caught it:
 *   - an action the query can return with NO sentence renders its own raw
 *     identifier to a verifier deciding whether somebody is incapacitated,
 *     because the JSX falls back to `h.action`;
 *   - a sentence for an action the query can NEVER return is a promise the
 *     product cannot keep, and it sits there looking like working code.
 *
 * IT READS THE FILE RATHER THAN IMPORTING IT. `VerifyClient.tsx` is a client
 * component: it imports `next/navigation` and the suite runs in the `node`
 * environment, so importing it to read one object would drag a router into a
 * unit test. `date-guards-are-scheduled.test.ts` reads a workflow file for the
 * same reason and records the same caveat — this is a structural check, and it
 * would not notice the map being renamed out from under it. The vacuity guard
 * below is what makes that survivable.
 *
 * Feature: relay-h0-mvp
 * Requirements: J7-R3 (B15.5)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TIMELINE_ACTIONS, RELEASE_TIMELINE_ACTIONS } from '../release/verifier-context';
import { CHECKIN_REMINDER_ACTIONS } from '../release/checkin-reminder';

const CLIENT = 'src/app/(verify)/verify/VerifyClient.tsx';

/**
 * The keys of `ACTION_LABEL`, taken from the object literal itself rather than
 * from the whole file — the header above quotes `checkin_reminder_sent` in prose
 * to explain it, and a check that reads its own explanation as a use is a check
 * that reports nonsense.
 */
function labelledActions(src: string): string[] {
  const start = src.indexOf('const ACTION_LABEL: Record<string, string> = {');
  if (start === -1) return [];
  const end = src.indexOf('};', start);
  const body = src.slice(start, end);
  return [...body.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
}

const source = readFileSync(join(process.cwd(), CLIENT), 'utf8');
const labelled = labelledActions(source);

describe('the label map is found at all', () => {
  it('so this suite is not vacuously green', () => {
    expect(
      labelled.length,
      `No ACTION_LABEL object literal was found in ${CLIENT}. Either it was renamed, or the ` +
        'timeline stopped being rendered from a map — either way this check is now reading ' +
        'nothing and must be repointed rather than deleted.',
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('every event the query can return has a sentence', () => {
  it.each([...TIMELINE_ACTIONS])('%s is labelled', (action) => {
    expect(
      labelled,
      `buildVerifierContext can put "${action}" on the timeline and ${CLIENT} has no sentence ` +
        `for it, so the verifier would be shown the string "${action}" itself.`,
    ).toContain(action);
  });
});

describe('every sentence corresponds to an event that can happen', () => {
  it('no label is for an action the query can never return', () => {
    const orphans = labelled.filter((a) => !TIMELINE_ACTIONS.includes(a));
    expect(
      orphans,
      orphans.length
        ? `${CLIENT} promises a sentence for actions buildVerifierContext does not read:\n` +
          `${orphans.map((o) => `  ${o}`).join('\n')}\n\n` +
          'This is the shape of the original defect: a label with no producer reads as a ' +
          'working feature. Either add the action to the query or delete the label.'
        : 'ok',
    ).toEqual([]);
  });
});

describe('the two halves of the timeline are both really in it', () => {
  /*
    The reminder actions are the half that was unreachable, and they arrive here
    by import from the ladder rather than by being written down again. If the
    ladder's rungs are renamed, this fails here rather than silently in
    production — which is the whole reason the list is derived.
  */
  it('carries the release events', () => {
    for (const a of RELEASE_TIMELINE_ACTIONS) expect(TIMELINE_ACTIONS).toContain(a);
  });

  it('carries every rung the check-in ladder actually writes', () => {
    expect(CHECKIN_REMINDER_ACTIONS.length).toBeGreaterThanOrEqual(2);
    for (const a of CHECKIN_REMINDER_ACTIONS) expect(TIMELINE_ACTIONS).toContain(a);
  });

  it('no longer names the action nothing writes', () => {
    expect(TIMELINE_ACTIONS).not.toContain('checkin_reminder_sent');
    expect(labelled).not.toContain('checkin_reminder_sent');
  });
});
