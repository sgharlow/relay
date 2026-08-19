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
 * stops being five things somebody has to remember, and to say plainly here
 * why the pipeline does not do it. Closing this properly needs a separate test
 * cluster, which is an infrastructure change with a cost attached and is
 * Steve's call, not a thing to arrange quietly inside a test file.
 */
describe('the live-verification gate', () => {
  it('exists and chains all five walks', () => {
    const live = pkg.scripts['verify:live'];
    expect(live, 'npm run verify:live is gone').toBeTruthy();
    for (const step of [
      'verify:stepup',
      'verify:multiowner',
      'verify:ui',
      'verify:reveal',
      'verify:factors',
    ]) {
      expect(live, `${step} dropped out of the live gate`).toContain(step);
    }
  });

  it('stops at the first failure, for the same reason `gate` does', () => {
    const live = pkg.scripts['verify:live'];
    expect(live).not.toContain(';');

    /*
      Every link is `&&`-joined, so one failure stops the chain. The count was
      pinned at 5 until 2026-08-19, when `verify:stamp` became a sixth link — so
      it is now derived from the steps present rather than hardcoded. A literal
      would have to be edited by whoever adds a walk, which is the moment they
      are least likely to think about it.
    */
    const steps = [...live.matchAll(/npm run (verify:[a-z-]+)/g)].map((m) => m[1]);
    expect(live.split('&&').length, 'a step is joined by something other than &&').toBe(steps.length);
    expect(steps.length, 'the live chain lost a step').toBeGreaterThanOrEqual(6);
  });

  /**
   * 🔴 THE ORDERING IS LOad-BEARING, not cosmetic.
   *
   * `verify:stamp` writes the line that `lib/ops/verify-live-freshness.test.ts`
   * treats as proof the walks ran. If it were reordered ahead of a walk, or
   * joined with `;`, it would record a completed run for a chain that then
   * failed — a stamp asserting success it did not witness, which is worse than
   * no stamp at all, because the dead-man would go quiet on the strength of it.
   */
  it('the stamp is the LAST link, so it can only witness a chain that passed', () => {
    const steps = [...pkg.scripts['verify:live'].matchAll(/npm run (verify:[a-z-]+)/g)].map((m) => m[1]);
    expect(
      steps[steps.length - 1],
      'verify:stamp is not last in verify:live. Anywhere else it records a run that had not ' +
        'finished — and the freshness dead-man would then read a stamp nothing earned.',
    ).toBe('verify:stamp');
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
    /*
      Added to the chain 2026-08-18, having shipped 2026-08-18 as a FIFTH walk
      nobody was told to run. Its own sprint report filed that as debt and
      opened no item: "it needs `.env.local` and a running server like the
      others, so it inherits the same 'somebody must remember' weakness".
      The same day supplied the argument against leaving it there. D1's
      fail-closed boundary (secret_kinds required on every vault write) broke
      e2e-multiowner and e2e-ui, and `gate` stayed green throughout, because
      the unit suite cannot see a real write path. A walk that proves the
      035 columns are not inert is exactly the walk that a change to those
      columns would break, so it belongs where a release runs it rather than
      where a person remembers it.
    */
    expect(pkg.scripts['verify:factors']).toContain('scripts/e2e-factors.ts');
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

/**
 * Every script that runs TypeScript must go through `npx`.
 *
 * 🔴 THE DEFECT THIS WAS WRITTEN FOR, found on 2026-08-19 by running the thing
 * rather than by reading it. `tsx` is NOT a declared dependency of this repo —
 * it is not in `dependencies`, not in `devDependencies`, and not in
 * `node_modules/.bin`. Every one of the eleven existing script entries fetches it
 * with `npx tsx`. Two new entries added the previous day used a bare `tsx`, and
 * both failed instantly:
 *
 *     'tsx' is not recognized as an internal or external command
 *
 * `verify:orphans` was merely broken. `verify:stamp` was worse: it is the LAST
 * link of `verify:live`, so the chain would have run all five walks — creating
 * and deleting real accounts on the production cluster — and then died at the
 * final step, leaving no stamp. The freshness dead-man would then have reported
 * that the walks had not run, on the day they had.
 *
 * Nothing in `gate` could see this: a string in package.json is not type-checked,
 * not linted, and not executed by any test. This check is the cheapest thing that
 * can.
 *
 * If `tsx` is ever added as a real devDependency, this guard should be replaced
 * rather than deleted — the invariant then becomes "declared or npx'd", not
 * "always npx".
 */
describe('scripts that run TypeScript can actually start', () => {
  it('tsx is invoked through npx, because it is not a declared dependency', () => {
    const declared =
      (pkg as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> })
        .dependencies?.tsx ??
      (pkg as { devDependencies?: Record<string, string> }).devDependencies?.tsx;

    if (declared) {
      /*
        The invariant changed rather than vanished. Left as a live branch so the
        day somebody declares tsx, this test says so instead of silently passing.
      */
      expect(declared, 'tsx is now declared — replace this guard with one that checks the version').toBeTruthy();
      return;
    }

    const bare = Object.entries(pkg.scripts)
      .filter(([, cmd]) => /(^|&&\s*)tsx\s/.test(cmd))
      .map(([name, cmd]) => `${name}: ${cmd}`);

    expect(
      bare,
      bare.length
        ? 'These scripts invoke a bare `tsx`, which is not installed — they fail with ' +
          '"\'tsx\' is not recognized" the moment anyone runs them:\n' +
          bare.map((b) => `  ${b}`).join('\n') +
          '\n\nUse `npx tsx`, as every other script in this file does. This matters most for ' +
          'verify:stamp: it is the last link of verify:live, so a broken invocation wastes the ' +
          'entire chain — five walks writing to the production cluster — and then leaves no ' +
          'stamp, which the freshness dead-man reads as "the walks never ran".'
        : 'ok',
    ).toEqual([]);
  });
});
