/**
 * What the coverage thresholds are actually about.
 *
 * 🔴 THE FINDING. CI has enforced lines 80 / functions 80 / branches 70 /
 * statements 80 since 2026-08-20, and the figure recorded when they were
 * switched on — 91.47% statements — was read as the project's. It was not. Two
 * separate mechanisms narrowed it to `lib/`:
 *
 *   1. `coverage.exclude` carried `'src/app/**'` with the comment "Next.js
 *      page/layout components — UI tested separately". That glob also removed
 *      all 75 `src/app/api/…/route.ts` handlers — the layer where every
 *      authentication, authorization and status decision in this product is
 *      made. 37 of those 75 had no test of their own, and the threshold step
 *      stayed green.
 *
 *   2. `coverage.include` was unset. Under Vitest 4 the v8 provider adds
 *      untested files to the denominator only when `include` is set
 *      (`@vitest/coverage-v8/dist/provider.js`: `if (this.options.include !=
 *      null && (allTestsRun || ...))`), so a file that no test imports
 *      contributed nothing at all — not a zero, an absence. A module could ship
 *      with no tests and raise the average.
 *
 * The measured figure that closed D8 therefore described the half of the
 * codebase that was already tested, which is the decorative-guard shape this
 * repo keeps meeting: a threshold that is real, and pointed away from the risk.
 *
 * ⚠️ THIS FILE CANNOT TELL YOU THE COVERAGE NUMBER. It asserts what is being
 * counted, not how much of it is covered — the thresholds in `vitest.config.ts`
 * do that, and only when CI runs `npm run test:coverage`. What this prevents is
 * the silent version: the scope quietly narrowing again while a percentage in a
 * planning document goes on being quoted as the project's.
 *
 * Feature: relay-h0-mvp
 * Requirements: D8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { COVERAGE_INCLUDE, COVERAGE_EXCLUDE, COVERAGE_UNMEASURED } from './coverage-scope';

const configSource = readFileSync(join(process.cwd(), 'vitest.config.ts'), 'utf8');

/**
 * Minimal glob → RegExp for the shapes this config uses: `**` across segments,
 * `*` within one, and a literal suffix. Deliberately hand-rolled — reaching
 * into a transitive dependency for a matcher would make this test's own
 * behaviour depend on a package nobody in this repo chose.
 */
function globToRegExp(glob: string): RegExp {
  const segments = glob.split('/');
  const body = segments
    .map((seg, i) => {
      if (seg === '**') {
        // Trailing `**` means "and everything below"; an interior one means
        // "zero or more whole segments", so that `a/…/b` still matches `a/b`.
        return i === segments.length - 1 ? '.*' : '(?:[^/]+/)*';
      }
      return `${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}/`;
    })
    .join('');
  return new RegExp(`^${body.replace(/\/$/, '')}$`);
}

/** Every file under `dir`, repo-relative, forward-slashed. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const measured = (file: string) =>
  COVERAGE_INCLUDE.some((g) => globToRegExp(g).test(file)) &&
  !COVERAGE_EXCLUDE.some((g) => globToRegExp(g).test(file));

/**
 * A COVERAGE_UNMEASURED key is a glob, optionally followed by ` !<glob>` naming
 * what it does NOT cover.
 *
 * The exception clause exists because the honest description of one area — "the
 * modules under src/app that are not route handlers" — is not expressible as a
 * single glob, and the alternatives were both worse: enumerate six directories
 * that go stale the moment somebody adds a seventh, or write `src/app/**` and
 * quietly contradict the fact that the request layer IS measured. A reason
 * attached to a glob that overstates its reach is the same class of mistake as
 * the exclude glob that started all of this.
 */
function unmeasuredMatcher(key: string): (file: string) => boolean {
  const [glob, ...exceptions] = key.split(' !');
  const positive = globToRegExp(glob);
  const negatives = exceptions.map(globToRegExp);
  return (file) => positive.test(file) && !negatives.some((re) => re.test(file));
}

describe('the glob matcher this file reasons with', () => {
  /*
    A scope check built on a broken matcher would report whatever the matcher
    happened to say — the same class of mistake as the scope it is checking. So
    the matcher gets its own cases, including the two that are easy to get
    wrong: an interior `**` matching zero segments, and a trailing one matching
    everything below.
  */
  it.each([
    ['lib/**/*.ts', 'lib/db/connection.ts', true],
    ['lib/**/*.ts', 'lib/instrument.ts', true],
    ['lib/**/*.ts', 'src/app/page.tsx', false],
    ['src/app/api/**/route.ts', 'src/app/api/access/route.ts', true],
    ['src/app/api/**/route.ts', 'src/app/api/triggers/[id]/cancel/route.ts', true],
    ['src/app/api/**/route.ts', 'src/app/api/access/session-branches.ts', false],
    ['src/app/**/*.tsx', 'src/app/(owner)/start/PriceCard.tsx', true],
    ['src/app/**/*.tsx', 'src/app/api/access/route.ts', false],
    ['**/*.d.ts', 'lib/auth/next-auth.d.ts', true],
    ['node_modules/**', 'node_modules/pg/lib/index.js', true],
  ])('%s vs %s', (glob, file, expected) => {
    expect(globToRegExp(glob).test(file)).toBe(expected);
  });
});

describe('the coverage scope is declared, not inherited from an exclude glob', () => {
  it('declares an include list, so an untested file is a zero rather than an absence', () => {
    expect(
      COVERAGE_INCLUDE,
      'vitest.config.ts no longer exports COVERAGE_INCLUDE. With coverage.include unset, ' +
        'Vitest counts only the files a test already imports, so a module that ships with no ' +
        'tests raises the average instead of lowering it.',
    ).toBeDefined();
    expect(COVERAGE_INCLUDE.length).toBeGreaterThan(0);
  });

  it('wires those lists into the coverage config rather than merely declaring them', () => {
    // A constant nothing reads is the same decoration one layer up.
    expect(
      configSource,
      'COVERAGE_INCLUDE is declared but coverage.include does not use it.',
    ).toMatch(/include:\s*COVERAGE_INCLUDE/);
    expect(
      configSource,
      'COVERAGE_EXCLUDE is declared but coverage.exclude does not use it.',
    ).toMatch(/exclude:\s*COVERAGE_EXCLUDE/);
  });
});

describe('the request layer is inside the measured scope', () => {
  const routes = walk('src/app/api').filter((f) => f.endsWith('/route.ts'));

  it('finds route handlers at all, so this suite is not vacuous', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it('every route handler is counted by the thresholds', () => {
    const unmeasured = routes.filter((r) => !measured(r));
    expect(
      unmeasured,
      unmeasured.length
        ? `${unmeasured.length} of ${routes.length} route handlers are outside the coverage ` +
          'scope. Every authentication, authorization and status decision in this product is ' +
          'made in this layer; a threshold that skips it stays green while the handlers lose ' +
          'every test they have. That is the state D8 was closed in.\n' +
          unmeasured
            .slice(0, 10)
            .map((u) => `  ${u}`)
            .join('\n')
        : 'ok',
    ).toEqual([]);
  });

  it('lib is still counted too — widening the scope must not have swapped one gap for another', () => {
    const libFiles = walk('lib').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'));
    const missed = libFiles.filter((f) => !measured(f));
    expect(missed, `${missed.length} lib file(s) fell out of the measured scope`).toEqual([]);
  });
});

describe('what is NOT measured says so, and says why', () => {
  it('names each unmeasured area with a reason', () => {
    expect(Object.keys(COVERAGE_UNMEASURED).length).toBeGreaterThan(0);
    for (const [glob, reason] of Object.entries(COVERAGE_UNMEASURED)) {
      expect(
        reason.length,
        `${glob} is outside the coverage scope with no reason recorded. An undated, ` +
          'unexplained exclusion is how the last one survived a review.',
      ).toBeGreaterThan(30);
    }
  });

  /*
    An exclusion describing files that no longer exist is how a scope drifts
    without anyone editing it: the glob stays, the reason stays, and the thing
    it was written about is gone. Requiring a live match makes the list decay
    loudly.
  */
  it('every unmeasured area still matches something real', () => {
    const everything = [...walk('lib'), ...walk('src')];
    for (const key of Object.keys(COVERAGE_UNMEASURED)) {
      const matches = unmeasuredMatcher(key);
      expect(
        everything.some(matches),
        `COVERAGE_UNMEASURED lists ${key}, which matches no file in the repo. Either the ` +
          'area moved or the entry is stale — delete it rather than leaving a reason attached ' +
          'to nothing.',
      ).toBe(true);
    }
  });

  it('no unmeasured area silently overlaps the request layer', () => {
    const routes = walk('src/app/api').filter((f) => f.endsWith('/route.ts'));
    for (const key of Object.keys(COVERAGE_UNMEASURED)) {
      const matches = unmeasuredMatcher(key);
      const hit = routes.filter(matches);
      expect(
        hit,
        `${key} is declared unmeasured and it matches ${hit.length} route handler(s). ` +
          'That is exactly how the layer disappeared the first time. If the area genuinely ' +
          'excludes the handlers, say so with an ` !` clause on the key rather than leaving ' +
          'the glob overstating its reach.',
      ).toEqual([]);
    }
  });

  /*
    The exception clause is the newest piece of machinery here and the easiest to
    get wrong in the direction that hides something — a `!` that matches too much
    would let an unmeasured entry quietly stop covering the files it claims to.
  */
  it('an exception clause narrows the area rather than nullifying it', () => {
    const key = 'src/app/**/*.ts !src/app/api/**';
    const matches = unmeasuredMatcher(key);
    expect(matches('src/app/caregivers/content.ts')).toBe(true);
    expect(matches('src/app/robots.ts')).toBe(true);
    expect(matches('src/app/api/access/route.ts')).toBe(false);
    expect(matches('src/app/api/triggers/[id]/cancel/route.ts')).toBe(false);
    expect(matches('lib/db/connection.ts')).toBe(false);
  });
});
