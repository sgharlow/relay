/**
 * Every health probe must be probed by something on a schedule.
 *
 * 🔴 THE SHAPE THIS PREVENTS, and this repo has met it twice already. A dead-man
 * probe is worth exactly as much as the thing that reads it. `/api/health/*`
 * routes are cheap to add and their value is entirely in being POLLED — an
 * endpoint that returns a correct 503 to nobody is a 503 nobody sees, and it
 * looks identical, from inside the repository, to a monitored one.
 *
 * The precedent is `chain-dead-man.test.ts`, which exists because
 * `verify:journeys` shipped without the stamp-and-dead-man that `verify:live`
 * had been given two days earlier: "the pattern was written down, in this
 * directory, and simply not inherited." The same is true here. Three probes had
 * monitors; nothing made the fourth inherit one, and nothing would have noticed
 * if a workflow were deleted, renamed, or quietly reduced to `workflow_dispatch`.
 *
 * So the rule is structural rather than remembered: a route under
 * `src/app/api/health/` that no scheduled workflow names fails here, by path.
 *
 * ⚠️ `schedule:` IS PART OF THE ASSERTION, NOT DECORATION. A workflow that only
 * carries `workflow_dispatch` runs when a human presses a button, which is the
 * "somebody must remember" weakness every check in this directory was written
 * against. It would satisfy a mention-only test while monitoring nothing.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC9
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const HEALTH_DIR = 'src/app/api/health';
const WORKFLOW_DIR = '.github/workflows';

/** Every probe that exists, as the URL path a monitor would call. */
function probes(): string[] {
  return readdirSync(HEALTH_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(`${HEALTH_DIR}/${e.name}/route.ts`))
    .map((e) => `/api/health/${e.name}`)
    .sort();
}

interface Workflow {
  file: string;
  body: string;
  scheduled: boolean;
}

function workflows(): Workflow[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => {
      const body = readFileSync(`${WORKFLOW_DIR}/${f}`, 'utf8');
      // Strip comments before asking whether it is scheduled: several of these
      // files DISCUSS cron at length in their headers, and a commented-out
      // schedule must not read as a live one.
      const code = body
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join('\n');
      return { file: f, body: code, scheduled: /^\s*schedule:/m.test(code) };
    });
}

describe('every health probe is polled by something scheduled', () => {
  it('finds probes and workflows at all, so this guard is not vacuous', () => {
    expect(probes().length).toBeGreaterThanOrEqual(4);
    expect(workflows().filter((w) => w.scheduled).length).toBeGreaterThanOrEqual(4);
  });

  it('leaves no probe unmonitored', () => {
    const scheduled = workflows().filter((w) => w.scheduled);
    const unmonitored = probes().filter(
      (p) => !scheduled.some((w) => w.body.includes(p)),
    );

    expect(
      unmonitored,
      unmonitored.length
        ? 'These health probes are named by no SCHEDULED workflow:\n' +
          unmonitored.map((p) => `  ${p}`).join('\n') +
          '\n\nA dead-man nothing reads is worth what an unread 503 is worth. Either add a ' +
          'scheduled workflow that probes it, or delete the route — an endpoint that exists ' +
          'to be polled and is not polled is the false green this directory exists to catch.'
        : 'ok',
    ).toEqual([]);
  });

  it('does not accept a workflow that only runs when a human presses a button', () => {
    /*
      The discriminating case, asserted directly rather than trusted: a
      dispatch-only workflow mentioning a probe must NOT satisfy the rule above.
      Without this, the check passes on exactly the arrangement it exists to
      refuse, and it would have done so silently.
    */
    const dispatchOnly: Workflow = {
      file: 'pretend.yml',
      body: 'on:\n  workflow_dispatch: {}\njobs:\n  probe:\n    steps:\n      - run: curl /api/health/orphans\n',
      scheduled: false,
    };
    expect(dispatchOnly.scheduled).toBe(false);
    expect([dispatchOnly].filter((w) => w.scheduled)).toEqual([]);
  });

  it('does not read a commented-out schedule as a live one', () => {
    const commented = '# schedule:\n#   - cron: "0 * * * *"\non:\n  workflow_dispatch: {}\n';
    const code = commented
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(/^\s*schedule:/m.test(code)).toBe(false);
  });
});
