/**
 * What the coverage thresholds are measured over.
 *
 * 🔴 THIS WAS NOT DECLARED UNTIL 2026-08-21, AND THE UNDECLARED ANSWER WAS
 * WRONG. `vitest.config.ts` switched its thresholds on 2026-08-20 against a
 * measured 91.47% statements, and that number was recorded as the project's.
 * It was a `lib/`-only number, for two reasons that compounded:
 *
 *   1. `coverage.exclude` carried `'src/app/**'`, annotated "Next.js
 *      page/layout components — UI tested separately". True as far as it went,
 *      and it also removed every `src/app/api/…/route.ts` handler: the layer
 *      that decides who is authenticated, what they may reach, and what status
 *      a refusal gets. 37 of the 75 handlers had no test of their own and the
 *      threshold step was green throughout.
 *
 *   2. `coverage.include` was unset. Vitest's v8 provider adds untested files
 *      to the denominator only when `include` is set — otherwise it counts
 *      nothing but the files some test already imports. A module shipped with
 *      no tests was not a zero dragging the average down; it was absent.
 *
 * MEASURED BEFORE WIDENING, 2026-08-21, so this is a change of scope and not a
 * change of standard. `lib` alone: 92.55% statements / 85.65% branches / 91.54%
 * functions / 93.89% lines. The 75 route handlers alone: 50.54 / 42.13 / 49.34
 * / 53.26. Weighting those two by their statement counts gives 81.90 / 74.96 /
 * 85.70 / 83.47 against thresholds of 80 / 70 / 80 / 80.
 *
 * ⚠️ THAT LAST SET OF FOUR IS ARITHMETIC, NOT A MEASUREMENT, and the difference
 * matters here. It is two subset runs combined on paper; no single run of the
 * shipped config has produced it. Statements is the binding figure and it has
 * under two points of margin, so the blend being a little optimistic is the
 * difference between a green CI and a red one.
 *
 * The one command that turns it into a measurement is `npm run test:coverage`,
 * and the first thing that will actually evaluate these thresholds is CI's own
 * `test:coverage` step — `npm run gate` runs `vitest --run`, which reads
 * `coverage.thresholds` not at all. So RUN IT BEFORE PUSHING anything that
 * moves coverage. If statements lands under 80 the answer is tests on the
 * weakest handlers, never a smaller threshold; see the paragraph below.
 *
 * Re-derive rather than quoting any of these figures. They are the evidence for
 * a decision taken on a date, not a claim about today.
 *
 * ⚠️ IF WIDENING THE SCOPE HAD BREACHED A THRESHOLD, THE ANSWER WOULD HAVE BEEN
 * TESTS, NOT A SMALLER NUMBER. Lowering a threshold so a newly-visible layer
 * fits inside it is how the guard became decorative in the first place.
 *
 * ⚠️ THIS FILE IS IMPORTED BY `vitest.config.ts`, so it must stay free of
 * imports and side effects. Anything it pulls in runs before a single test does,
 * and a failure here stops the whole suite rather than one file.
 *
 * Feature: relay-h0-mvp
 * Requirements: D8
 */

/** Globs whose files are counted by the coverage thresholds. */
export const COVERAGE_INCLUDE = [
  'lib/**/*.ts',
  // The request layer. Auth, authorization and status decisions live here.
  'src/app/api/**/route.ts',
];

/**
 * Kept narrow on purpose. With `include` set, these are exceptions carved out
 * of a declared scope rather than the mechanism that defines it — which is the
 * inversion that let a UI-shaped glob silently decide what CI measures.
 */
export const COVERAGE_EXCLUDE = [
  'node_modules/**',
  // Type declarations have no statements to cover; counting them is noise.
  '**/*.d.ts',
];

/**
 * Areas deliberately outside the measurement, each with the reason it is out.
 *
 * `coverage-scope.test.ts` asserts that every entry here has a reason, still
 * matches real files, and does not overlap the request layer — so an exclusion
 * cannot quietly grow into "and also the handlers" a second time.
 */
export const COVERAGE_UNMEASURED: Record<string, string> = {
  /*
    🔴 MEASURED 2026-08-21, AND THE NUMBER IS THE REASON. Widening the scope to
    these modules as well as the route handlers put the blended figure at 79.30%
    statements — under the 80 threshold. Routes alone blend to 81.90%, which is
    why they are in and these are not. (Both of those are the paper blend the
    header describes, not a single run.)

    That is the finding, not a reason to move the threshold: lowering 80 so a
    newly-visible layer fits inside it is precisely how this guard became
    decorative. They come in when they are tested, and the measurement to redo
    is `npm run test:coverage` with this key removed.

    The key carries an exception clause (`!`) because route handlers live under
    `src/app` too and are deliberately measured — see `coverage-scope.test.ts`,
    which fails if an unmeasured area ever swallows the request layer again.
  */
  'src/app/**/*.ts !src/app/api/**':
    'The non-route modules under src/app — page copy, analytics helpers, robots and sitemap. ' +
    "(Count them: `find src/app -name '*.ts' ! -name '*.test.ts' ! -name route.ts | wc -l`. A " +
    'number was written here as a standing fact on 2026-08-21 and was wrong the same day, in ' +
    'the file whose whole purpose is to stop a stale figure being quoted as the project\'s.) ' +
    'They sat at 49.95% statements measured on 2026-08-21, and including them then would have ' +
    'put the blended figure at 79.30%, below the threshold. Left out with the number recorded ' +
    'rather than let in with the threshold lowered; the answer is tests, and this entry goes ' +
    'when they exist.',
  'src/app/**/*.tsx':
    'Pages, layouts and client components. Their tests assert rendered output and copy rather ' +
    'than executing the module under instrumentation, so a percentage over them would measure ' +
    'how much of a component a JSDOM render happens to touch. `npm run gate:build` is what ' +
    'proves this layer compiles; the a11y and design-system suites are what prove it behaves.',
  'src/hooks/**':
    'Two browser-only hooks (passkey enrolment, session end). Both are exercised through the ' +
    'components that use them, in the .tsx layer above, and neither is reachable from a Node ' +
    'test without standing up a WebAuthn-capable DOM.',
  'src/instrumentation.ts':
    'The Next.js runtime hook. It is invoked by the framework at process start and by nothing a ' +
    'test can call; the error reporting it delegates to is covered in lib/ops.',
};

/**
 * The request layer's OWN floor, separate from the blended thresholds in
 * `vitest.config.ts`.
 *
 * 🔴 WHY A SECOND NUMBER IS NEEDED AT ALL. The header above records that the
 * route handlers were brought INTO the measured scope on 2026-08-21, which was
 * right and which stopped a whole layer being absent from the denominator. What
 * it could not do is stop that layer's shortfall being absorbed by a larger one.
 * `lib/**` carries ~5,000 statements and the request layer ~1,600, so on
 * 2026-08-30 the blended figure read 87.61% while the layer that decides who is
 * authenticated, what they may reach and what status a refusal gets sat at
 * 66.15% statements / 59.17% branches — with 26 of 76 handlers executing no test
 * at all. Every threshold in this repo was green throughout.
 *
 * A blended average is a weighted one. This is the weight removed.
 *
 * MEASURED 2026-08-30 after the T1 sprint: 86.81% statements, 79.45% branches
 * over `src/app/api/**` alone. The floors below sit a little under that on
 * purpose — a floor set exactly at the measured value turns any unrelated
 * refactor into a red build, which is how a guard acquires a reputation for
 * crying wolf and then gets lowered. The margin is small enough that losing a
 * handler's tests still fails.
 *
 * ⚠️ RATCHET UPWARD, NEVER DOWN. `request-layer-floor.test.ts` fails if either
 * number is reduced below the baseline recorded there. If a change puts the
 * layer under the floor, the answer is tests on the handler that dropped — the
 * same rule the header above states for the blended thresholds, and the same
 * reason: lowering a number so a newly-visible gap fits inside it is precisely
 * how this guard became decorative the first time.
 *
 * Read by `scripts/check-route-coverage.ts`, which CI runs immediately after
 * `test:coverage`.
 */
export const REQUEST_LAYER_FLOOR = {
  /** Glob prefix, matched against paths relative to the repo root. */
  prefix: 'src/app/api/',
  statements: 85,
  branches: 78,
} as const;

/**
 * Below this many measured handler files, the coverage report is not describing
 * the request layer — the include globs changed, or the run was partial. That is
 * a "could not look", which is a different answer from "passed" and gets its own
 * exit code. Deliberately well under the real count so it never fires on a
 * legitimately removed route.
 */
export const REQUEST_LAYER_MIN_FILES = 60;

/**
 * A coverage report's absolute path, reduced to a repo-relative one.
 *
 * 🔴 THIS EXISTS BECAUSE THE FIRST VERSION WAS A REGEX AND IT WAS WRONG IN CI,
 * 2026-08-30. It read `absolute.replace(/^.*?\/relay\//, '')` — non-greedy, so
 * it stopped at the FIRST `/relay/`. On this laptop the path is
 * `C:/Users/.../CascadeProjects/relay/src/app/api/...` and that is correct. On a
 * GitHub runner the checkout is `/home/runner/work/relay/relay/src/app/api/...`
 * — the repo name appears TWICE — so it yielded `relay/src/app/api/...`, which
 * matched no prefix, and the check reported zero files in the request layer.
 *
 * ⚠️ THE FAILURE WAS SAFE, AND THAT WAS THE DESIGN RATHER THAN LUCK. A report
 * describing fewer than `REQUEST_LAYER_MIN_FILES` handlers is "could not look"
 * (exit 2), not "passed", so CI went red on the first run instead of reporting a
 * meaningless green. Had the fallback been exit 0, this bug would have made the
 * floor decorative on the very commit that introduced it — which is the exact
 * shape of every defect this file's header describes.
 *
 * Anchored on the working directory, with the layer prefix as a fallback, and
 * tested against all three real path shapes in `request-layer-floor.test.ts`.
 *
 * ⚠️ NO IMPORTS — not even `node:path`. This module is pulled in by
 * `vitest.config.ts` before a single test runs, and the header above states the
 * rule. String logic only.
 */
export function toRepoRelative(absolute: string, cwd: string): string {
  const norm = (s: string): string =>
    s.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '');
  const a = norm(absolute);
  const c = norm(cwd);

  // Primary: the report's paths are files inside the directory the check runs
  // from. Compared case-insensitively because Windows disagrees with itself
  // about drive-letter case (`C:/` vs `c:/`).
  if (c.length > 0 && a.toLowerCase().startsWith(c.toLowerCase() + '/')) {
    return a.slice(c.length + 1);
  }

  // Fallback for any layout where that does not hold — a nested checkout, a
  // symlinked workspace, a report generated elsewhere. `lastIndexOf` rather than
  // `indexOf`, which is precisely the bug above: take the DEEPEST occurrence, so
  // a path that repeats a directory name resolves to the real source root.
  const marker = '/src/';
  const at = a.lastIndexOf(marker);
  if (at !== -1) return a.slice(at + 1);

  return a;
}
