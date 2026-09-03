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

  it('🔴 can still SEND the alert from the scheduler’s environment, which has no Resend key', () => {
    /*
      Found 2026-09-02, the day after the "alert delivered" proof. That proof ran
      from a shell that had RESEND_API_KEY exported; the Task Scheduler's
      environment does not, and this script loads no env file. So the installed
      task would detect a dead production and print "ALERT COULD NOT BE SENT" —
      a muted watchdog, which the address guard exists to prevent and did not.
      The key must be readable from the repo's own gitignored `.env.local` when
      the process environment lacks it.
    */
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    const cmd = pkg.scripts.heartbeat;
    expect(cmd, 'the key lives in .env.local; the script must be started so it can read it').toContain(
      '--env-file-if-exists=.env.local',
    );
    expect(cmd, 'a hard --env-file= exits 9 wherever the file is absent, before the address guard can speak').not.toMatch(
      /--env-file=/,
    );
    expect(CODE).toMatch(/RESEND_API_KEY/);
  });
});

describe('the heartbeat installer', () => {
  const PS1 = readFileSync('scripts/install-heartbeat-task.ps1', 'utf8');
  const PS1_CODE = PS1.replace(/<#[\s\S]*?#>/g, '').replace(/^[ \t]*#.*$/gm, '');

  it('refuses to install a task that could not send its alert', () => {
    // The address guard alone lets a task install and then mute itself; the key
    // must be visible to the task — in the shell, or in `.env.local` — as well.
    expect(PS1_CODE).toMatch(/RESEND_API_KEY/);
    expect(PS1_CODE).toMatch(/\.env\.local/);
  });

  it('🔴 parses under Windows PowerShell 5.1, which reads a BOM-less file as ANSI', () => {
    /*
      Found 2026-09-02 on the first real run. The script had an em dash inside
      a `throw "..."` string; `powershell.exe` (5.1, what the board and the
      header both say to use) decoded the BOM-less UTF-8 as Windows-1252, the
      dash's third byte became a closing smart quote, and the file did not
      parse. The 09-01 version carried the same characters and was never run.
      Either the file carries a BOM, which 5.1 honours, or it is pure ASCII.
    */
    const raw = readFileSync('scripts/install-heartbeat-task.ps1');
    const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
    const pureAscii = raw.every((b) => b < 0x80);
    expect(hasBom || pureAscii, 'add a UTF-8 BOM or strip the non-ASCII characters').toBe(true);
  });

  it('does not demand elevation the task never needed', () => {
    // The task runs as the current user, so a User-scope variable is visible to
    // it and Register-ScheduledTask works from a normal shell. Insisting on
    // Machine scope + an elevated shell kept the task uninstalled for a day.
    expect(PS1).toMatch(/'User'/);
    expect(PS1).not.toMatch(/RUN THIS FROM AN ELEVATED/);
  });
});
