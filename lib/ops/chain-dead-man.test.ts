/**
 * Every chain of live walks must end in a stamp, and every stamp must be read by
 * a dead-man. Asserted structurally, so the next chain cannot ship without one.
 *
 * WHY THIS IS A CHECK AND NOT A NOTE (B14). The repo already had the pattern.
 * `verify:live` was given `stamp-verify-live.ts` plus
 * `verify-live-freshness.test.ts` on 2026-08-19, with a file-header explaining
 * that a check whose success signal is a side effect must have that signal's
 * ABSENCE monitored. Two days later `verify:journeys` shipped — three walks, same
 * credentials, same production cluster, same "somebody must remember" weakness —
 * with no stamp and no dead-man, and D10 was closed on its construction. The
 * pattern was written down, in this directory, and not inherited.
 *
 * So the fix is not a third careful author. It is this: a chain declared in
 * package.json that runs more than one walk and does NOT end in a stamp fails
 * here, by name, with the two files it is missing.
 *
 * This is the same argument every check in `lib/ops/` makes — "a guard that lives
 * in a helper is a guard on the helper" — applied one level up, to the guards
 * themselves.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the remembering half); B14
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

interface Chain {
  /** The npm script that runs the chain. */
  script: string;
  /** The npm script that stamps it, expected as the chain's final `&&`. */
  stamp: string;
  /** The log the stamp appends to. */
  log: string;
  /** The test file whose dead-man reads that log. */
  deadMan: string;
}

/**
 * The chains, and the four files each one needs. Adding a chain to package.json
 * without adding it here fails the completeness test below — the entry is not
 * bookkeeping, it is the declaration that the chain has a dead-man.
 */
const CHAINS: Chain[] = [
  {
    script: 'verify:live',
    stamp: 'verify:stamp',
    log: 'docs/verify-live-runs.jsonl',
    deadMan: 'lib/ops/verify-live-freshness.test.ts',
  },
  {
    script: 'verify:journeys',
    stamp: 'verify:stamp:journeys',
    log: 'docs/verify-journeys-runs.jsonl',
    deadMan: 'lib/ops/verify-journeys-freshness.test.ts',
  },
];

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

/**
 * A chain is a `verify:*` script that runs two or more walks. A single-walk
 * script (`verify:reveal`, `verify:delegate`) is a component of one, not a chain
 * — it is legitimately runnable alone and is stamped by the chain that contains
 * it. `verify:schema` and friends read rather than walk; they create no rows and
 * leave nothing to age.
 */
function walkCount(body: string): number {
  return body.split('&&').filter((part) => /npm run verify:(?!stamp)/.test(part)).length;
}

describe('every chain of live walks ends in a stamp', () => {
  for (const chain of CHAINS) {
    it(`${chain.script} runs its stamp as the final step`, () => {
      const body = pkg.scripts[chain.script];
      expect(body, `${chain.script} is not declared in package.json`).toBeTruthy();

      const steps = body.split('&&').map((s) => s.trim());
      expect(
        steps[steps.length - 1],
        `${chain.script} must END with \`npm run ${chain.stamp}\`. A stamp that is not last ` +
          'records a chain that had not finished — and a stamp that is merely present somewhere ' +
          'in the middle would be written even when a later walk fails, which is the one thing ' +
          'the stamp must never do.',
      ).toBe(`npm run ${chain.stamp}`);
    });

    it(`${chain.script}'s dead-man and log both exist`, () => {
      expect(pkg.scripts[chain.stamp], `${chain.stamp} is not declared`).toBeTruthy();
      expect(existsSync(chain.log), `${chain.log} is missing — the stamp has nowhere to write`).toBe(true);
      expect(
        existsSync(chain.deadMan),
        `${chain.deadMan} is missing — ${chain.log} would be written and read by nothing, which ` +
          'is the same as not writing it',
      ).toBe(true);
    });
  }
});

describe('COMPLETENESS — no chain escapes the list above', () => {
  /**
   * The half that actually prevents recurrence. The two tests above only check
   * chains somebody remembered to declare; this one finds the chain nobody did.
   */
  it('every multi-walk verify:* script in package.json is declared as a chain', () => {
    const declared = new Set(CHAINS.map((c) => c.script));

    const undeclared = Object.entries(pkg.scripts)
      .filter(([name]) => name.startsWith('verify:') && !name.startsWith('verify:stamp'))
      .filter(([, body]) => walkCount(body) >= 2)
      .map(([name]) => name)
      .filter((name) => !declared.has(name));

    expect(
      undeclared,
      `These chains run live walks and are not declared in CHAINS, so nothing ages them: ` +
        `${undeclared.join(', ')}. That is how verify:journeys shipped without a dead-man two ` +
        'days after verify:live was given one. Each needs a stamp script, a .jsonl log, a ' +
        'freshness module and a dead-man test — copy the verify:journeys set.',
    ).toEqual([]);
  });
});
