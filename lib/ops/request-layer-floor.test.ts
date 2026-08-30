/**
 * The request layer's own coverage floor cannot be quietly dropped or lowered.
 *
 * 🔴 THE DEFECT, MEASURED 2026-08-30. `vitest.config.ts` enforces coverage over
 * `lib/**` and `src/app/api/**` together, and those layers are not the same
 * size — roughly 5,000 statements against 1,600. So the blended figure read
 * 87.61%, comfortably over an 80 threshold, while the layer that decides who is
 * authenticated, what they may reach and what status a refusal gets sat at
 * 66.15% statements and 59.17% branches, with 26 of 76 handlers executing no
 * test at all. Every gate in this repo was green throughout, including the
 * coverage gate, because an average is precisely the instrument that hides this.
 *
 * ⚠️ THIS IS THE THIRD TIME THIS GUARD HAS NEEDED A SIBLING, and the shape has
 * not changed. `coverage-scope.ts` records the first two: an `exclude` glob that
 * silently removed the whole handler layer, and an unset `include` that made an
 * untested file ABSENT from the denominator rather than a zero in it. Both were
 * green. `lib/ops/` exists because "a guard that lives in a helper is a guard on
 * the helper"; this is that argument applied to the coverage gate itself.
 *
 * So the floor is not protected by anyone remembering it. It is protected by:
 *   1. the script being DECLARED in package.json,
 *   2. CI INVOKING it, immediately after the run that produces the report,
 *   3. the numbers never being RATCHETED DOWN below the baseline below.
 *
 * All three fail here, by name, rather than in a review.
 *
 * Feature: relay-h0-mvp
 * Requirements: D8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

import { REQUEST_LAYER_FLOOR, REQUEST_LAYER_MIN_FILES } from './coverage-scope';

const SCRIPT = 'scripts/check-route-coverage.ts';
const NPM_SCRIPT = 'check:route-coverage';
const WORKFLOW = '.github/workflows/ci.yml';

/**
 * The floor as ratified on 2026-08-30, against a measured 86.81% statements /
 * 79.45% branches.
 *
 * ⚠️ THESE MAY BE RAISED AND MUST NEVER BE LOWERED. If a change puts the layer
 * under the floor, the answer is tests on the handler that dropped — never a
 * smaller number. Raising the floor means raising this baseline in the same
 * commit, which is a deliberate act with a diff; lowering it fails here.
 */
const BASELINE = { statements: 85, branches: 78 };

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

describe('the floor is declared', () => {
  it('names the layer it measures', () => {
    expect(REQUEST_LAYER_FLOOR.prefix).toBe('src/app/api/');
  });

  it('is at or above the ratified baseline', () => {
    expect(
      REQUEST_LAYER_FLOOR.statements,
      'The request-layer statement floor was LOWERED. The answer to a drop is tests on the ' +
        'handler that dropped, not a smaller floor — see lib/ops/coverage-scope.ts for what ' +
        'happened the last two times a coverage number was made to fit the code.',
    ).toBeGreaterThanOrEqual(BASELINE.statements);
    expect(
      REQUEST_LAYER_FLOOR.branches,
      'The request-layer branch floor was LOWERED. Same rule.',
    ).toBeGreaterThanOrEqual(BASELINE.branches);
  });

  it('demands the report actually describe the request layer', () => {
    // Without this, a coverage run that measured one file would report 100% and
    // pass — a green about nothing, which is the failure mode this whole file
    // is about.
    expect(REQUEST_LAYER_MIN_FILES).toBeGreaterThanOrEqual(60);
  });
});

describe('the guard is wired, not merely written', () => {
  it('the script exists', () => {
    expect(existsSync(SCRIPT), `${SCRIPT} is missing`).toBe(true);
  });

  it('package.json declares it', () => {
    expect(pkg.scripts[NPM_SCRIPT], `package.json has no "${NPM_SCRIPT}" script`).toBeDefined();
    expect(pkg.scripts[NPM_SCRIPT]).toContain('check-route-coverage');
  });

  it('CI invokes it', () => {
    const ci = readFileSync(WORKFLOW, 'utf8');
    expect(
      ci,
      `${WORKFLOW} does not run "${NPM_SCRIPT}". A floor nothing invokes is a comment.`,
    ).toContain(`npm run ${NPM_SCRIPT}`);
  });

  it('CI invokes it AFTER the run that produces the report', () => {
    /*
      Order is the property, not presence. This script reads
      `coverage/coverage-final.json` and does not produce it, so running it
      before `test:coverage` would measure whatever an earlier run left behind —
      a green about a run that never happened. It exits 2 rather than 0 when the
      report is absent, so a reordering fails loudly; this asserts the order so
      it does not have to.
    */
    const ci = readFileSync(WORKFLOW, 'utf8');
    const producer = ci.indexOf('npm run test:coverage');
    const consumer = ci.indexOf(`npm run ${NPM_SCRIPT}`);
    expect(producer, 'CI does not run test:coverage at all').toBeGreaterThan(-1);
    expect(consumer).toBeGreaterThan(producer);
  });
});
