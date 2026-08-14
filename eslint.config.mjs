/**
 * Flat config, replacing .eslintrc.json.
 *
 * WHY THIS MOVED. `eslint-config-next` was pinned at 14.2.35 against Next 16,
 * and its dependency chain carried the repo's only outstanding high-severity
 * advisory — a command injection in the `glob` CLI, reachable through
 * `@next/eslint-plugin-next`. Nothing in the production bundle was affected and
 * nothing invoked the vulnerable flag, so this was never urgent; it was
 * outstanding, which is different, and a release note that says "we looked at
 * it" should be able to say "and it is gone".
 *
 * eslint-config-next 16 requires ESLint 9, and ESLint 9 reads flat config. So
 * the advisory fix and this file are the same change.
 *
 * WHAT IS DELIBERATELY PRESERVED, because a lint config that quietly stops
 * enforcing something is worse than an out-of-date one:
 *   - `^_`-prefixed unused vars stay allowed. CLAUDE.md names this as a
 *     convention to preserve, and several files rely on it.
 *   - `scripts/scratch-*.ts` stays ignored — throwaway QA fixtures that have
 *     reached the repo before.
 *   - `--max-warnings=0` stays in the npm script, so a warning is still a
 *     failure. That flag, not this file, is what makes lint a gate.
 *
 * `--ext` is gone from the lint script because ESLint 9 removed it; which files
 * are linted is decided here instead, and the `files` globs below are what
 * replace it. That is the one behavioural difference to know about.
 */

/*
  Imported directly, NOT through FlatCompat. eslint-config-next 16 already
  exports flat config arrays; wrapping them in the eslintrc compatibility shim
  makes it try to JSON-serialise plugin objects that reference each other, and
  ESLint dies on "Converting circular structure to JSON" rather than on anything
  that names the real problem. Worth the comment — the error gives no hint that
  the shim is the mistake.
*/
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  {
    /*
      Everything not worth linting. `.next` and `coverage` are generated;
      `demo-out` holds rendered video drafts. These were implicit under
      .eslintrc.json's defaults and have to be stated explicitly under flat
      config, which ignores far less by default.
    */
    ignores: [
      '.next/**',
      'coverage/**',
      'node_modules/**',
      'demo-out/**',
      'public/**',
      'next-env.d.ts',
      // Throwaway QA fixtures. They label themselves "not committed" and three
      // of them still reached the repo, so the ignore is load-bearing.
      'scripts/scratch-*.ts',
      // Scratch probe scripts written at the repo root; gitignored by `_*.ts`.
      '_*.ts',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    files: ['**/*.{ts,tsx,mjs}'],
    rules: {
      // Preserved from .eslintrc.json — see the header.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      /*
        🔴 OFF, DELIBERATELY, AND THIS IS THE ONLY RULE THAT IS.
        `react-hooks/set-state-in-effect` arrived with eslint-plugin-react-hooks
        7 — part of the React Compiler suite — and flags ELEVEN existing
        components. Every one is the same documented pattern: read something
        only the browser knows (a query parameter, a stored channel, the current
        URL) in an effect and set state from it, so the page stays statically
        renderable.

        The rule is making a fair performance point about cascading renders. It
        is not reporting a defect: these screens were walked end to end on
        production on 2026-08-13 and behave correctly. Rewriting eleven
        components — including the recipient access plan, the verifier decision
        surface and the seed wizard — to satisfy a rule that arrived with a
        tooling upgrade, in the same change as that upgrade, days before a beta,
        is precisely the sweeping edit to working code this repo keeps deciding
        not to make.

        So it is off, once, with the reason, rather than suppressed eleven times
        where it would read as noise. Everything else the new plugin versions
        found IS addressed, at its site.

        REVISIT when the React Compiler is actually adopted; the migration is
        the same work either way, and the rule is a good guide for it.
      */
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
