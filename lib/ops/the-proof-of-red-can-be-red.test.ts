/**
 * The a11y gate's proof-of-red is two halves in two files, and either one alone
 * is decoration.
 *
 * 🔴 THE FAILURE THIS GUARDS AGAINST ALREADY HAPPENED IN THIS REPOSITORY, to a
 * different workflow. `production-canary.yml` carried a `workflow_dispatch`
 * comment claiming for its whole life that the alarm could be proven on demand,
 * and it could not — the step took no argument, so a manual run could only ever
 * pass, and in ~1,200 runs it was never once red. `kms-wall.yml`'s header
 * records that, and B13's bar came out of it: a checker that has only ever
 * passed has not been seen to work.
 *
 * D21 gave `a11y.yml` a `dsql_role` input so the owner-mode half can be pointed
 * at a database role that does not exist and watched to fail. That input is
 * WORTHLESS ON ITS OWN. `scripts/a11y-audit.mjs` has always exited 0 when it
 * could not mint an owner session — correctly, because CI genuinely could not
 * reach a database until now — so the proof-of-red dispatch would have broken
 * the connection, printed the skip notice, and PASSED. `A11Y_REQUIRE_OWNER` is
 * what turns that skip into a failure, and the two shipped together.
 *
 * So this asserts the PAIRING rather than either piece: an input the script
 * cannot fail on, or a script guard no workflow ever sets, both leave the owner
 * half of this gate unprovable while looking exactly as it does today.
 *
 * ⚠️ IT ASSERTS WIRING, NOT BEHAVIOUR. Only a dispatch against the real role
 * proves the run actually goes red — step 6 of docs/d21-runner-db-oidc-proposal.md
 * §7, and until that has happened the owner half is `built`, not live-proven.
 *
 * Feature: relay-h0-mvp
 * Requirements: CC8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const WORKFLOW_PATH = join(process.cwd(), '.github', 'workflows', 'a11y.yml');
const SCRIPT_PATH = join(process.cwd(), 'scripts', 'a11y-audit.mjs');

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  run?: string;
  if?: string;
}

function workflow(): {
  on?: Record<string, { inputs?: Record<string, { description?: string; default?: string }> }>;
  permissions?: Record<string, string>;
  jobs: Record<string, { steps: Step[] }>;
} {
  return parse(readFileSync(WORKFLOW_PATH, 'utf8'));
}

/** The one step that starts the server and runs the audit — they are the same step on purpose. */
function auditStep(): Step {
  const steps = workflow().jobs.axe.steps;
  const found = steps.find((s) => typeof s.run === 'string' && s.run.includes('a11y-audit.mjs'));
  if (!found) throw new Error('no step in a11y.yml runs scripts/a11y-audit.mjs');
  return found;
}

describe('the a11y gate keeps the name master requires', () => {
  it('is still called axe', () => {
    // `axe` is a REQUIRED CHECK on master (CLAUDE.md → "master IS BRANCH PROTECTED").
    // Renaming the job removes the gate rather than moving it: the required check
    // stops reporting, and GitHub waits forever for a name nothing produces.
    expect(Object.keys(workflow().jobs)).toEqual(['axe']);
  });
});

describe('the proof-of-red is wired end to end', () => {
  it('offers a dispatch input that points the run at a database role', () => {
    const input = workflow().on?.workflow_dispatch?.inputs?.dsql_role;
    expect(input, 'a11y.yml has no dsql_role dispatch input').toBeDefined();
    expect(input?.default).toBe('relay_ro');
    // The description has to say what the input is FOR. An input whose purpose
    // lives only in a comment above it is one somebody sets to the wrong thing.
    expect(input?.description).toMatch(/does not exist|RED/i);
  });

  it('feeds that input to the audit step as DSQL_ROLE', () => {
    expect(auditStep().env?.DSQL_ROLE).toContain('inputs.dsql_role');
  });

  it('arms the script guard in the same step, or the input proves nothing', () => {
    const requireOwner = auditStep().env?.A11Y_REQUIRE_OWNER;
    expect(requireOwner, 'the audit step does not set A11Y_REQUIRE_OWNER').toBeDefined();
    // Armed exactly when owner mode is being audited. A constant '1' would go red
    // on every pull request, where the role's master-ref pin means the session
    // can never be minted — and `axe` is a required check there.
    expect(requireOwner).toContain('1');
    expect(auditStep().env?.A11Y_SCOPE).toContain('all');
  });

  it('the script honours the guard and exits non-zero on a skipped owner scope', () => {
    const src = readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).toContain('A11Y_REQUIRE_OWNER');
    expect(src).toMatch(/if \(ownerSkipReason && REQUIRE_OWNER\)/);
    expect(src).toMatch(/OWNER MODE WAS REQUIRED AND WAS NOT AUDITED/);
    // The exit has to come BEFORE the page-count check, which would otherwise
    // report a whole missing scope as an arithmetic discrepancy.
    expect(src.indexOf('OWNER MODE WAS REQUIRED')).toBeLessThan(src.indexOf('REACHED ${audited}'));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   REVIEW ROUND 1, 2026-09-02. Both cases below pin defects a reviewer found in
   the first version of this workflow, and they share a shape with everything
   else in this file: BOTH WERE GREEN ON EVERY PULL REQUEST AND BROKEN ON EXACTLY
   THE ARMED RUNS D21 EXISTS FOR. A workflow whose two halves fail in different
   conditions cannot be judged by whether its checks are passing.
   ──────────────────────────────────────────────────────────────────────────── */
describe('the harness survives its own installation', () => {
  it('installs every --no-save package in ONE command', () => {
    /*
      🔴 `npm i` REIFIES THE WHOLE TREE FROM THE LOCKFILE. A second
      `npm i --no-save <other>` therefore PRUNES whatever the first added — the
      lockfile does not name it. Playwright and tsx are both --no-save, so two
      steps delete one of them, and which one depends only on the order.
      Reproduced on npm 11.5.2, the npm Node 24 ships.

      The first version installed tsx in a SECOND step, conditional on owner
      mode, so a pull request installed only playwright and passed while every
      armed run would have died in resolvePlaywright(). Counting the commands is
      the only form of this rule that cannot be got wrong by reordering them.
    */
    // Comment lines are dropped first — the header above the step explains the
    // trap and quotes the very command being counted, and a guard that counts
    // its own explanation is the vacuous-matcher failure this file is about.
    const installs = readFileSync(WORKFLOW_PATH, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .filter((l) => /npm\s+(i|install)\s/.test(l) && l.includes('--no-save'));
    expect(installs.length, `found ${installs.length} --no-save installs:\n${installs.join('\n')}`).toBe(1);
    expect(installs[0]).toContain('playwright@');
    expect(installs[0]).toContain('tsx@');
  });
});

describe('arming reads the REF, not just the event', () => {
  it('refuses owner mode on any ref that is not refs/heads/master', () => {
    /*
      The trust policy pins `repo:sgharlow/relay:ref:refs/heads/master`. A
      workflow_dispatch from a branch is not a pull_request, so an event-only
      test armed it — and the assume step would then fail, reporting a
      configuration choice as a broken audit. The event is not the ref.
    */
    const arming = workflow().jobs.axe.steps.find((s) => (s.run ?? '').includes('OWNER_MODE=yes'));
    expect(arming, 'no step decides OWNER_MODE').toBeDefined();
    expect(arming?.run).toContain('github.ref');
    expect(arming?.run).toContain('refs/heads/master');
  });

  it('carries no database configuration into a run that cannot use it', () => {
    // Gated the same way A11Y_SCOPE is, so a pull request job holds no endpoint,
    // no role and no region — rather than values it has no credential to use.
    for (const key of ['DSQL_PRIMARY_ENDPOINT', 'DSQL_ROLE', 'AWS_REGION']) {
      expect(auditStep().env?.[key], `${key} is not gated on OWNER_MODE`).toContain(
        "env.OWNER_MODE == 'yes'",
      );
    }
  });
});

describe('the runner reaches the database the way the ruling allows', () => {
  it('mints an OIDC token rather than reading a stored credential', () => {
    expect(workflow().permissions?.['id-token']).toBe('write');
    const assume = workflow().jobs.axe.steps.find((s) =>
      (s.uses ?? '').startsWith('aws-actions/configure-aws-credentials'),
    );
    expect(assume, 'a11y.yml never assumes a role').toBeDefined();
    expect(assume?.with?.['role-to-assume']).toBe(
      'arn:aws:iam::461293170793:role/relay-ro-ci',
    );
  });

  it('never names an AWS access key — the whole point of "yes, VIA OIDC"', () => {
    // A stored database credential in a public repository's Actions secrets
    // would be a standing target with no expiry. The ruling was the shape, not
    // just the permission.
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    expect(raw).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
  });

  it('connects as relay_ro by default, which is SELECT and nothing else', () => {
    expect(workflow().on?.workflow_dispatch?.inputs?.dsql_role?.default).toBe('relay_ro');
    expect(auditStep().env?.DSQL_ROLE).toContain("'relay_ro'");
  });
});
