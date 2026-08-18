/**
 * `npm run gate` must actually run all four checks, and must stop on the first
 * failure.
 *
 * 🔴 THE FAILURE THIS PREVENTS ALREADY HAPPENED, ON 2026-08-14. Four separate
 * commands were being run and their logs read individually, and one of those
 * reads was of a STALE log — the pre-push hook had blocked the command before
 * the build inside it ever ran, so the "green" belonged to an earlier run while
 * a JSX comment beside a root element had broken the build. The test suite
 * stayed green throughout, because vitest does not compile `src/app`, so two
 * apparently independent signals agreed and one of them was a memory.
 *
 * The structural answer is one command whose exit code is the answer. `&&`
 * rather than `;` so a later check cannot paper over an earlier failure, and
 * `tsc` first because it is the fastest of the four and catches most of what
 * the others would.
 *
 * This test exists because a convenience script is exactly the kind of thing
 * that gets "tidied" into something that no longer fails.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

describe('the single-command gate', () => {
  it('exists and chains all four checks', () => {
    const gate = pkg.scripts.gate;
    expect(gate, 'npm run gate is gone').toBeTruthy();
    for (const step of ['gate:types', 'gate:lint', 'gate:test', 'gate:build']) {
      expect(gate, `${step} dropped out of the gate`).toContain(step);
    }
  });

  it('stops at the first failure rather than running on', () => {
    // `;` would run every step and report the LAST one's status — which is the
    // shape of the bug this replaces.
    expect(pkg.scripts.gate).not.toContain(';');
    expect(pkg.scripts.gate.split('&&').length).toBe(4);
  });

  it('each step is the real check, not an alias that could drift', () => {
    expect(pkg.scripts['gate:types']).toContain('tsc --noEmit');
    expect(pkg.scripts['gate:lint']).toContain('--max-warnings=0');
    expect(pkg.scripts['gate:test']).toContain('vitest --run');
    expect(pkg.scripts['gate:build']).toContain('next build');
  });

  /*
    The build step is the one that matters most here and is the easiest to
    argue away as slow. It is the ONLY check that compiles src/app: tsc will
    catch most type errors, but the failure that started this — a JSX comment
    placed beside a root element — surfaced only in the bundler.
  */
  it('keeps the build in the gate, because it is the only thing that compiles src/app', () => {
    expect(pkg.scripts.gate).toContain('gate:build');
  });
});

/**
 * The second gate: the one that needs a database and a running server.
 *
 * WHY IT IS SEPARATE FROM `gate` AND NOT IN CI. These walks CREATE AND DELETE
 * REAL ROWS, and `.env.local` points at the production cluster because there is
 * no other one — Relay has no dev database. A job that did this on every push
 * would be writing to the customers' database to check a pull request, and the
 * accounts it forgot to clean up would be the ones nobody was watching. (An
 * early run of the multi-owner walk left four behind, which is precisely the
 * argument.)
 *
 * The honest resolution is not to smuggle it into CI. It is to make it ONE
 * command a person runs deliberately before a release, so "run the E2E walks"
 * stops being four things somebody has to remember, and to say plainly here
 * why the pipeline does not do it. Closing this properly needs a separate test
 * cluster, which is an infrastructure change with a cost attached and is
 * Steve's call, not a thing to arrange quietly inside a test file.
 */
describe('the live-verification gate', () => {
  it('exists and chains all four walks', () => {
    const live = pkg.scripts['verify:live'];
    expect(live, 'npm run verify:live is gone').toBeTruthy();
    for (const step of ['verify:stepup', 'verify:multiowner', 'verify:ui', 'verify:reveal']) {
      expect(live, `${step} dropped out of the live gate`).toContain(step);
    }
  });

  it('stops at the first failure, for the same reason `gate` does', () => {
    expect(pkg.scripts['verify:live']).not.toContain(';');
    expect(pkg.scripts['verify:live'].split('&&').length).toBe(4);
  });

  it('each step points at the real harness', () => {
    expect(pkg.scripts['verify:stepup']).toContain('scripts/e2e-stepup.ts');
    expect(pkg.scripts['verify:multiowner']).toContain('scripts/e2e-multiowner.ts');
    expect(pkg.scripts['verify:ui']).toContain('scripts/e2e-ui.ts');
    /*
      The walk that proves the moment the product exists for. Added 2026-08-17
      because J8's evidence had gone stale in the most expensive way available:
      the last live proof of the decrypt round trip was 2026-08-08 and it proved
      a screen that Phase 0 then replaced. Three green walks said nothing about
      it, because none of them reveals anything.
    */
    expect(pkg.scripts['verify:reveal']).toContain('scripts/e2e-reveal.ts');
  });

  /*
    It must NOT be folded into `gate`. `gate` is the fast, credential-free check
    that CI runs on every push; adding a walk that needs DSQL and a live server
    would make the ordinary gate fail for anyone without production credentials
    — which is everyone except the maintainer, and every CI runner.
  */
  it('is not folded into the credential-free gate', () => {
    expect(pkg.scripts.gate).not.toContain('verify:');
  });
});
