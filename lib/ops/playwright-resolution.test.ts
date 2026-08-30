/**
 * The browser walks must be runnable by somebody who is not Steve.
 *
 * 🔴 THE DEFECT. Both scripts that drive a real browser resolved Playwright as
 * `PLAYWRIGHT_MODULE || file:///${HOME}/CascadeProjects/__shared-tools/...`. The
 * override was real and CI used it, but the DEFAULT was a sibling directory of
 * one checkout on one computer. On a clean clone, on the other PC, or in any job
 * that forgets the env var, the import fails naming somebody's home directory.
 *
 * That is expensive here specifically. `e2e-ui` is the ONLY functional browser
 * walk in the repository — the other four walks in `verify:live` drive HTTP, and
 * that walk's own header says why that is not enough: "a guard that refuses
 * correctly and a prompt nobody can answer look identical over HTTP". So the one
 * check able to tell those apart was reachable from a single machine.
 *
 * ⚠️ AND `a11y-audit.mjs` CARRIED THE SAME FOUR LINES, immediately below a
 * comment banning exactly that: "C:/Users/<someone> path is unrunnable for
 * anyone else and is banned by the portfolio's own rule." The rule was written
 * down, in the file, directly above the line that broke it.
 *
 * These assert the resolution ORDER rather than that an import succeeds, because
 * whether Playwright is installed differs legitimately between machines — and a
 * test that only passes where it is installed would be the machine-specific
 * failure it is meant to prevent, one level up.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the walks half)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

import { candidates, sharedToolsSpecifier, INSTALL_HINT } from '../../scripts/resolve-playwright.mjs';

const SCRIPTS = ['scripts/e2e-ui.ts', 'scripts/a11y-audit.mjs'];

const original = process.env.PLAYWRIGHT_MODULE;
afterEach(() => {
  if (original === undefined) delete process.env.PLAYWRIGHT_MODULE;
  else process.env.PLAYWRIGHT_MODULE = original;
});

describe('the resolution order', () => {
  it('tries a bare specifier before any machine-specific path', () => {
    delete process.env.PLAYWRIGHT_MODULE;
    const c = candidates();
    const bare = c.indexOf('playwright');
    const shared = c.findIndex((s) => s.includes('__shared-tools'));

    expect(bare, 'the bare specifier is not tried at all — a clean checkout cannot run the walks').toBeGreaterThan(-1);
    if (shared !== -1) {
      expect(
        bare,
        'the shared-tools path is tried BEFORE node_modules, so a locally installed Playwright ' +
          'is shadowed by one laptop’s copy',
      ).toBeLessThan(shared);
    }
  });

  it('lets an explicit override win, which is what CI relies on', () => {
    process.env.PLAYWRIGHT_MODULE = 'playwright-core';
    expect(candidates()[0]).toBe('playwright-core');
  });

  it('never makes a machine-specific path the only route', () => {
    delete process.env.PLAYWRIGHT_MODULE;
    const c = candidates();
    const portable = c.filter((s) => !s.includes('__shared-tools') && !s.startsWith('file://'));
    expect(
      portable.length,
      'every candidate is a path on somebody’s disk — there is no way to run these walks on a ' +
        'machine that is not this one',
    ).toBeGreaterThan(0);
  });

  it('carries an install hint a person can run', () => {
    expect(INSTALL_HINT).toMatch(/npm i .*playwright/);
    expect(INSTALL_HINT).toMatch(/playwright install/);
  });

  it('tolerates an environment with no home directory', () => {
    // A container with neither HOME nor USERPROFILE must still get the bare
    // specifier rather than a `file:///undefined/...` candidate.
    const home = process.env.HOME;
    const profile = process.env.USERPROFILE;
    try {
      delete process.env.HOME;
      delete process.env.USERPROFILE;
      expect(sharedToolsSpecifier()).toBeNull();
      expect(candidates()).toContain('playwright');
    } finally {
      if (home !== undefined) process.env.HOME = home;
      if (profile !== undefined) process.env.USERPROFILE = profile;
    }
  });
});

/**
 * Non-comment lines only.
 *
 * 🔴 THE OBVIOUS IMPLEMENTATION OF THIS WAS WRONG, AND IT WAS WRONG IN THE
 * DIRECTION THAT MATTERS. It stripped block comments with a regex and then
 * stripped everything after a double slash on each line, as a line comment. But
 * the string this whole test exists to find is `file:///C:/Users/...`, and that
 * prefix CONTAINS a double slash. The line-comment pass treated it as the start
 * of a comment and deleted the rest of the line, so a hardcoded path was
 * invisible to the check written to catch it. Caught by planting the exact
 * violation and watching the guard stay green (2026-08-30).
 *
 * This is the same shape as `api-reachability`'s recorded module-specifier false
 * positive, and the same lesson: a checker that parses source has to be proven
 * against the thing it is looking for, not merely written carefully.
 *
 * Line-oriented instead, which cannot make that mistake: a line is a comment
 * when it STARTS with one.
 */
export function codeOnly(src: string): string {
  return (
    src
      // Block comments are unambiguous, and this repo writes long ones whose
      // continuation lines carry no leading `*` — so they cannot be recognised
      // line by line, which a first attempt at this tried.
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      /*
        A line comment — but only where the double slash follows neither a colon
        nor another slash. BOTH exclusions are needed and the second is the one
        that is easy to miss: `https://` is caught by the colon rule, while
        `file:///` has THREE slashes, so its second pair is preceded by a slash
        and slips straight past a colon-only rule. That was this checker's second
        wrong version in a row, both found by the self-tests below rather than by
        reading it.
      */
      .replace(/(^|[^:/])\/\/[^\n]*/g, '$1')
  );
}

function codeLines(file: string): string {
  return codeOnly(readFileSync(file, 'utf8'));
}

describe('the comment stripper survives a URL', () => {
  // The self-tests the first version needed and did not have. Without these the
  // guard below reports "clean" on the exact line it exists to find.
  it('does not treat file:/// as a line comment', () => {
    const line = "const PW = 'file:///C:/Users/x/__shared-tools/playwright/index.mjs';";
    expect(codeOnly(line)).toContain('__shared-tools');
  });

  it('leaves an https URL intact', () => {
    expect(codeOnly("const u = 'https://relaystandby.com/api';")).toContain('relaystandby.com/api');
  });

  it('still removes a real line comment', () => {
    expect(codeOnly('const a = 1; // __shared-tools')).not.toContain('__shared-tools');
    expect(codeOnly('// __shared-tools')).not.toContain('__shared-tools');
  });

  it('still removes a block comment, including one with no leading asterisks', () => {
    expect(codeOnly('/*\n  __shared-tools is discussed here\n*/\nconst a = 1;')).not.toContain(
      '__shared-tools',
    );
  });
});

describe('neither browser script reintroduces its own copy', () => {
  it.each(SCRIPTS)('%s resolves through the shared helper, in code', (file) => {
    // Asserted against CODE, not the whole file: both scripts DISCUSS the helper
    // by name in their comments, so a whole-file `toContain` passes on the
    // explanation of a fix that has been removed.
    expect(
      codeLines(file),
      `${file} does not import resolve-playwright — only mentions it`,
    ).toContain('resolve-playwright.mjs');
  });

  it.each(SCRIPTS)('%s hardcodes no __shared-tools path outside a comment', (file) => {
    /*
      Comments may DISCUSS the old path — both files explain the finding at
      length, and this test would be self-defeating if that counted. Code may
      not contain it: two copies of a resolution rule is the rule expressed
      twice, and the second copy is the one nobody re-reads.
    */
    expect(codeLines(file)).not.toContain('__shared-tools');
  });
});
