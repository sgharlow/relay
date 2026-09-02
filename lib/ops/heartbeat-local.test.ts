/**
 * The off-GitHub heartbeat keeps the properties that make it worth having.
 *
 * B12.i exists because the GitHub-scheduled canary is dropped (~6 runs/day
 * against a designed 96) and a watchdog cannot live inside the thing it
 * watches. Three properties make it a watchdog rather than a script, and each
 * is one edit away from being lost:
 *
 *   1. It probes PRODUCTION, not just a run count. A heartbeat that only counts
 *      GitHub runs reports green while the site is down.
 *   2. It checks GitHub DELIVERY too. Without it, the condition that created
 *      this script — the cloud watchdog going quiet — is invisible.
 *   3. It REFUSES to run without an alert address, and reads that address
 *      WITHOUT the app's non-production gate. `opsAlertAddress()` returns
 *      undefined in any environment it can label non-production, which is right
 *      for the app and fatal here: `NODE_ENV=development` in a Task Scheduler
 *      environment would mute every alert while the script kept exiting 0.
 *
 * This is a source-level guard, deliberately: the behaviour it protects needs a
 * live production probe and a scheduler to exercise, and a test that shells out
 * to production on every `npm test` is worse than the drift it prevents.
 *
 * Feature: relay-h0-mvp
 * Requirements: B12.i
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('scripts/heartbeat-local.ts', 'utf8');

/**
 * The source with comments removed.
 *
 * 🔴 EVERY NEGATIVE ASSERTION BELOW READS THIS, NOT `SRC`. A check that forbids
 * naming something also forbids documenting why it is forbidden — and this repo
 * has now hit that exact trap five times, twice while writing the guard that
 * records it. The first two versions of the assertion below failed against the
 * docstring explaining the rule, including one that required a call's
 * parentheses and matched `opsAlertAddress()` in prose.
 *
 * Positive assertions may read either; a comment mentioning a required string
 * is a weaker signal but not a false one.
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('the off-GitHub heartbeat', () => {
  it('probes production itself, rather than trusting a run count', () => {
    expect(SRC).toContain('scripts/canary.ts');
    expect(SRC, 'the production probe must target a real base URL').toContain('CANARY_BASE_URL');
  });

  it('also checks whether GitHub is still delivering the scheduled canary', () => {
    expect(SRC).toContain('production-canary.yml/runs');
    expect(SRC).toMatch(/event=="schedule"/);
  });

  it('🔴 refuses to run with no alert address, instead of running silently', () => {
    // The whole point. A watchdog whose alerts are muted still exits 0, and its
    // silence is indistinguishable from good news.
    expect(SRC).toMatch(/NO ALERT ADDRESS/);
    expect(SRC).toMatch(/process\.exit\(2\)/);
  });

  it('does NOT read the address through the app’s non-production gate', () => {
    /*
      `opsAlertAddress()` is correct for the application — a preview deploy must
      not page anyone — and wrong for an operator tool that runs off-platform,
      where the environment is legitimately not production and the alert still
      has to arrive.
    */
    /*
      ⚠️ THIS ASSERTION MATCHES A CALL OR AN IMPORT, NOT THE WORD. Its first
      version was `SRC.includes('opsAlertAddress')` and it failed immediately —
      on the docstring above that EXPLAINS why the gate is not used. That is the
      fifth recorded instance in this repo of a negative grep matching the
      comment describing the rule, and the trap is worth the extra precision:
      a check that forbids naming a thing also forbids documenting why.
    */
    expect(
      /opsAlertAddress|alert-address/.test(CODE),
      'heartbeat-local.ts must read OPS_ALERT_ADDRESS directly; the app gate returns ' +
        'undefined off-platform and would mute the watchdog',
    ).toBe(false);
    expect(SRC).toContain('OPS_ALERT_ADDRESS');
  });

  it('treats "could not look" as its own outcome, never as healthy', () => {
    // The repo's established three-state convention: 0 healthy, 1 finding,
    // 2 could-not-look. Collapsing 2 into 0 is how a monitor lies.
    expect(SRC).toContain('could-not-look');
    expect(SRC).toMatch(/gh api unavailable/);
  });

  it('writes its stamp somewhere gitignored, so it cannot dirty the tree', () => {
    expect(SRC).toContain('.heartbeat');
    expect(readFileSync('.gitignore', 'utf8')).toContain('.heartbeat/');
  });
});
