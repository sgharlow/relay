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
