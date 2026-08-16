/**
 * Every `verify:*` command is written down somewhere a person will find it.
 *
 * WHY. The two gates this repo relies on outside CI — `verify:live` and
 * `verify:schema` — are commands a human has to remember to run. Their whole
 * value is that somebody runs them at the right moment, so a `verify:*` script
 * that exists in `package.json` and appears in no runbook is not a safeguard;
 * it is a file. The repo has met this shape before in a smaller form: the
 * backup runbook's own header notes that "a runbook that references an
 * untracked file works on exactly one computer."
 *
 * `verify:funnel` is the case that prompted this. It guards the instrument a
 * four-week, $250 ad flight is measured by, and it is useful exactly once per
 * day for four weeks — which means the failure mode is not that it breaks, but
 * that nobody remembers it exists on day nine.
 *
 * So the rule is mechanical: a command in `package.json` must be named in
 * `CLAUDE.md` (where someone working in the repo looks) or in a doc under
 * `docs/` (where someone running a process looks). Adding a script and no
 * instructions fails here rather than being discovered by its absence.
 *
 * This deliberately checks only that the command is MENTIONED. Whether the
 * surrounding instructions are any good is a human judgement, and a test that
 * pretended otherwise would be measuring something adjacent to what it claims.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const claudeMd = readFileSync('CLAUDE.md', 'utf8');
const docs = readdirSync('docs')
  .filter((f) => f.endsWith('.md'))
  .map((f) => readFileSync(`docs/${f}`, 'utf8'))
  .join('\n');
const haystack = `${claudeMd}\n${docs}`;

/**
 * `verify:live` is a composite that only runs the three walks below it; each of
 * those is documented through it rather than by name, which is the intended
 * shape and not a gap.
 */
const DOCUMENTED_THROUGH_THEIR_PARENT = new Set([
  'verify:stepup',
  'verify:multiowner',
  'verify:ui',
]);

describe('verify:* commands are documented where someone will look', () => {
  const commands = Object.keys(pkg.scripts).filter((s) => s.startsWith('verify:'));

  it('finds the verify commands at all, so this suite is not vacuous', () => {
    expect(commands.length).toBeGreaterThanOrEqual(3);
  });

  for (const cmd of commands) {
    if (DOCUMENTED_THROUGH_THEIR_PARENT.has(cmd)) continue;

    it(`\`npm run ${cmd}\` is named in CLAUDE.md or a doc`, () => {
      expect(
        haystack.includes(cmd),
        `\`${cmd}\` exists in package.json but no runbook mentions it. ` +
          `A gate nobody is told to run is not a gate — document when to run it, ` +
          `or delete the script.`,
      ).toBe(true);
    });
  }
});
