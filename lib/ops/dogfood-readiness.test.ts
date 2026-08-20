/**
 * The readiness verdict, proven by removing one piece at a time.
 *
 * The interesting cases are not "everything is missing" — that was the state on
 * 2026-08-20 and it is easy to get right. They are the near-misses: a vault with
 * items and no access rule, which looks populated and cannot host an invitation;
 * and a vault populated entirely by demo fixtures, which satisfies every count
 * while proving nothing.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessDogfoodReadiness, summarise, type DogfoodCounts } from './dogfood-readiness';

function ready(): DogfoodCounts {
  return {
    realOwners: 1,
    demoOwners: 0,
    vaultItems: 3,
    recipients: 1,
    verifiers: 1,
    accessRules: 2,
    releaseConfigs: 1,
  };
}

describe('the control', () => {
  it('a fully populated vault is ready, so every red below is the plant', () => {
    const v = assessDogfoodReadiness(ready());
    expect(v.missing).toEqual([]);
    expect(v.ready).toBe(true);
    expect(summarise(v)).toContain('READY');
  });
});

describe('each piece, removed on its own', () => {
  const pieces: Array<[keyof DogfoodCounts, string]> = [
    ['vaultItems', 'vault item'],
    ['recipients', 'recipient'],
    ['verifiers', 'verifier'],
    ['accessRules', 'access rule'],
    ['releaseConfigs', 'release trigger'],
  ];

  for (const [field, label] of pieces) {
    it(`is not ready with no ${label}`, () => {
      const counts = ready();
      counts[field] = 0;
      const v = assessDogfoodReadiness(counts);
      expect(v.ready, `${field} = 0 should block readiness`).toBe(false);
      expect(v.missing.map((m) => m.what).join(' ')).toContain(label);
    });

    it(`names a concrete action for a missing ${label}`, () => {
      const counts = ready();
      counts[field] = 0;
      const piece = assessDogfoodReadiness(counts).missing.find((m) => m.what.includes(label));
      // A checklist item with no action is a complaint.
      expect(piece?.action.length ?? 0, `no action given for ${label}`).toBeGreaterThan(10);
      expect(piece?.why.length ?? 0, `no reason given for ${label}`).toBeGreaterThan(10);
    });
  }
});

describe('the near-misses, which are the point', () => {
  it('items and people but no access rule is NOT ready', () => {
    /*
      The realistic half-done state: a vault that looks populated in the UI, with
      two lists that have nothing between them. An invitee accepting here would
      still be standing by for nothing reachable.
    */
    const counts = ready();
    counts.accessRules = 0;
    const v = assessDogfoodReadiness(counts);
    expect(v.ready).toBe(false);
    expect(v.missing.map((m) => m.why).join(' ')).toContain('two lists');
  });

  it('a vault populated only by demo fixtures is not counted at all', () => {
    /*
      reset-demo.ts can manufacture every number here in seconds. If the caller
      excludes demo owners correctly, this is what that looks like arriving: all
      real counts zero, demo owners present. The verdict must say so rather than
      reporting a bare zero, or the reader concludes the data was lost.
    */
    const v = assessDogfoodReadiness({
      realOwners: 0,
      demoOwners: 1,
      vaultItems: 0,
      recipients: 0,
      verifiers: 0,
      accessRules: 0,
      releaseConfigs: 0,
    });
    expect(v.ready).toBe(false);
    expect(v.note ?? '').toContain('reset-demo');
  });

  it('with no real owner it reports one problem, not seven', () => {
    const v = assessDogfoodReadiness({
      realOwners: 0,
      demoOwners: 0,
      vaultItems: 0,
      recipients: 0,
      verifiers: 0,
      accessRules: 0,
      releaseConfigs: 0,
    });
    // Six consequences of one absence read as six problems and send the reader
    // in six directions.
    expect(v.missing).toHaveLength(1);
    expect(v.missing[0].what).toContain('owner');
  });

  it('a real owner alongside demo accounts still reports the demo exclusion', () => {
    const counts = ready();
    counts.demoOwners = 2;
    const v = assessDogfoodReadiness(counts);
    expect(v.ready, 'demo accounts existing does not make a real vault unready').toBe(true);
    expect(v.note ?? '').toContain('excluded');
  });
});

describe('the shell that runs it', () => {
  const SCRIPT = readFileSync(join(process.cwd(), 'scripts/verify-dogfood.ts'), 'utf8');

  it('contains no mutating SQL', () => {
    /*
      This probe reads production. A verification script that can write is one
      typo away from being the incident it was meant to detect, so the guarantee
      is asserted rather than intended.
    */
    for (const verb of ['INSERT', 'UPDATE ', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'GRANT']) {
      expect(
        SCRIPT.toUpperCase().includes(verb),
        `scripts/verify-dogfood.ts contains ${verb.trim()} — this script must be read-only`,
      ).toBe(false);
    }
  });

  it('distinguishes "not ready" from "could not run"', () => {
    // A probe that exits the same way for both lets a broken probe read as a
    // clean result — the false-green shape this repo keeps meeting.
    expect(SCRIPT).toContain('process.exit(1)');
    expect(SCRIPT).toContain('process.exit(2)');
  });

  it('is wired as an npm script, or nobody will ever run it', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['verify:dogfood'], 'no verify:dogfood script declared').toBeTruthy();
    expect(pkg.scripts['verify:dogfood']).toContain('scripts/verify-dogfood.ts');
    // It reads a live cluster, so it needs the env file the other probes use.
    expect(pkg.scripts['verify:dogfood']).toContain('--env-file=.env.local');
  });
});
