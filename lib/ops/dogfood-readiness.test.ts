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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessDogfoodReadiness,
  countDogfood,
  gateCohortInvite,
  summarise,
  type DogfoodCounts,
} from './dogfood-readiness';

function ready(): DogfoodCounts {
  return {
    realOwners: 1,
    demoOwners: 0,
    disposableOwners: 0,
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
    disposableOwners: 0,
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
    disposableOwners: 0,
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

describe('the actions name screens that actually exist', () => {
  /*
    🔴 THEY DID NOT. Two actions read "name a recipient in /people" — a route
    that has never existed in this product. Recipients and verifiers are added in
    /circle. The probe was written to tell an operator what to do next, and it
    confidently sent them to a 404. Found by reading the app router while walking
    Steve through the very steps this text describes.

    The repo already checks the other direction for code: fetch-routes-exist
    asserts no `fetch` names a route nothing serves. Prose had no such check —
    and prose is what a human actually follows.
  */
  function appPages(): Set<string> {
    const root = join(process.cwd(), 'src', 'app');
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'page.tsx') {
          const url = full
            .slice(root.length)
            .split(String.fromCharCode(92))
            .join('/')
            .replace(/\/page\.tsx$/, '')
            // Route groups — (owner), (access) — are not part of the URL.
            .replace(/\/\([^)]+\)/g, '');
          found.add(url === '' ? '/' : url);
        }
      }
    };
    walk(root);
    return found;
  }

  const PAGES = appPages();

  it('discovered the app router pages at all, or this check is blind', () => {
    expect(PAGES.size, 'no pages found — the walk is broken, not the actions').toBeGreaterThan(5);
    expect(PAGES.has('/vault/new'), 'sanity: /vault/new must be discoverable').toBe(true);
    expect(PAGES.has('/circle'), 'sanity: /circle must be discoverable').toBe(true);
  });

  it('every route mentioned in an action is a real page', () => {
    const actions = assessDogfoodReadiness({
      realOwners: 1,
      demoOwners: 0,
      disposableOwners: 0,
      vaultItems: 0,
      recipients: 0,
      verifiers: 0,
      accessRules: 0,
      releaseConfigs: 0,
    }).missing.map((m) => m.action);

    expect(actions.length, 'no actions to check').toBeGreaterThan(0);

    const bad: string[] = [];
    for (const action of actions) {
      for (const match of action.match(/(?:^|\s)(\/[a-z][a-z0-9/-]*)/g) ?? []) {
        const route = match.trim().replace(/[.,]$/, '');
        if (!PAGES.has(route)) bad.push(`${route} — in: "${action}"`);
      }
    }

    expect(bad, `these actions send the reader to routes that do not exist:\n  ${bad.join('\n  ')}`)
      .toEqual([]);
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

  it('asks for the counts through the shared definition, not its own SQL', () => {
    // Two copies of "what counts as ready" is two things to drift.
    expect(SCRIPT).toContain('countDogfood');
    expect(SCRIPT, 'the SQL belongs in lib/ops, so both callers ask the same question').not.toContain(
      'FROM vault_items',
    );
  });

  it('is wired as an npm script, or nobody will ever run it', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['verify:dogfood'], 'no verify:dogfood script declared').toBeTruthy();
    expect(pkg.scripts['verify:dogfood']).toContain('scripts/verify-dogfood.ts');
    /*
      It reads a live cluster, so it needs a credentialed env file — and since it
      ONLY reads, it must use the READ-ONLY one.

      This asserted `.env.local` until 2026-08-21, which was right when that was
      the only credential that existed and became wrong the day `relay_ro` did.
      `.env.local` is IAM relay-dev: full DML on every product table and
      `kms:Decrypt`. `.env.ro` is relay_ro: SELECT and nothing else, no KMS. A
      probe that only counts rows has no business holding the ability to change
      or decrypt them, and the guard should say so rather than merely requiring
      "an env file" — which would let it drift back to the stronger identity
      without anything noticing.
    */
    expect(
      pkg.scripts['verify:dogfood'],
      'verify:dogfood must run as the read-only identity (.env.ro): it only reads, and .env.local ' +
        'carries write access and kms:Decrypt',
    ).toContain('--env-file=.env.ro');
  });
});

describe('the counts come from one definition', () => {
  it('countDogfood asks for every field, and excludes demo owners in each', async () => {
    const asked: string[] = [];
    const counts = await countDogfood(async (sql) => {
      asked.push(sql);
      return 1;
    });

    // Every field the verdict reads must actually have been queried; a field left
    // at a default would silently read as zero and manufacture a missing piece.
    for (const key of Object.keys(counts) as Array<keyof DogfoodCounts>) {
      expect(counts[key], `${key} was not populated`).toBe(1);
    }

    /*
      🔴 THE ASSERTION THAT MATTERS, and the weaker version of it shipped first.
      It used to require only that each query mentioned `is_demo_account` — which
      every query did, and which was not enough, because NOTHING SETS that column.
      The walk accounts arrive through ordinary signup on reserved domains and
      were counted as real owners with real vault items.

      So: every count that is scoped to real owners must carry BOTH exclusions.
      The two tally queries are the deliberate exceptions and are named, rather
      than allowed through by a loose filter.
    */
    // The two tallies count the EXCLUDED populations, so by definition they do
    // not carry the exclusions. Named individually rather than filtered loosely,
    // because a loose filter is how the weak version of this test let everything
    // through in the first place.
    const demoTally = asked.filter((s) => s.includes('WHERE COALESCE(is_demo_account, false)'));
    const disposableTally = asked.filter((s) => s.includes('WHERE NOT (lower(email)'));
    expect(demoTally, 'the demo tally query went missing').toHaveLength(1);
    expect(disposableTally, 'the reserved-domain tally query went missing').toHaveLength(1);

    const tallies = [...demoTally, ...disposableTally];
    const scoped = asked.filter((s) => !tallies.includes(s));

    for (const q of scoped) {
      expect(q, `query does not exclude demo owners: ${q}`).toContain('NOT COALESCE(is_demo_account');
      expect(q, `query does not exclude reserved-domain walk accounts: ${q}`).toContain('NOT LIKE');
    }
    expect(scoped.length, 'the real-owner-scoped counts went missing').toBe(6);
    expect(asked.length, 'no queries were issued at all').toBe(8);
  });
});

describe('the cohort refusal', () => {
  const notReady = () =>
    assessDogfoodReadiness({
      realOwners: 1,
      demoOwners: 0,
    disposableOwners: 0,
      vaultItems: 0,
      recipients: 0,
      verifiers: 0,
      accessRules: 0,
      releaseConfigs: 0,
    });

  it('lets a ready vault through', () => {
    const d = gateCohortInvite(assessDogfoodReadiness(ready()), false);
    expect(d.refuse).toBe(false);
  });

  it('refuses an unready vault, and says how to override', () => {
    const d = gateCohortInvite(notReady(), false);
    expect(d.refuse).toBe(true);
    expect(d.message).toContain('REFUSED');
    // A refusal with no way forward is a refusal somebody deletes.
    expect(d.message).toContain('--anyway');
    expect(d.message).toContain('verify:dogfood');
  });

  it('names every missing piece in the refusal, not just the first', () => {
    const d = gateCohortInvite(notReady(), false);
    for (const piece of ['vault item', 'recipient', 'verifier', 'access rule', 'release trigger']) {
      expect(d.message, `refusal does not mention ${piece}`).toContain(piece);
    }
  });

  it('proceeds under --anyway but prints what is being overridden', () => {
    const d = gateCohortInvite(notReady(), true);
    expect(d.refuse).toBe(false);
    expect(d.message).toContain('PROCEEDING ANYWAY');
    expect(d.message).toContain('vault item');
  });
});

describe('the refusal is placed where it can actually refuse', () => {
  const COHORT = readFileSync(join(process.cwd(), 'scripts/invite-cohort.ts'), 'utf8');

  it('invite-cohort CALLS the gate, not merely imports it', () => {
    /*
      ⚠️ This asserted `toContain('gateCohortInvite')` first, and a plant that
      deleted the call left the import line behind — so it passed on exactly the
      defect it was written for. That is the same shape as the check in this repo
      that matched "Stripe" inside "NotStripe". Match the call.
    */
    expect(COHORT).toContain('gateCohortInvite(assessDogfoodReadiness(');
  });

  it('gates AFTER the dry-run return, so listing the roster is never blocked', () => {
    /*
      Blocking the dry run would push an operator toward --commit just to see
      anything, which is the opposite of what this protects.
    */
    const dryRun = COHORT.indexOf('if (!COMMIT)');
    const gate = COHORT.indexOf('gateCohortInvite(');
    expect(dryRun).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(dryRun);
  });

  it('gates BEFORE anyone is created, or it is a guard on nothing', () => {
    /*
      The failure this repo keeps meeting: a check that exists, runs, and sits
      after the work it was meant to prevent. Ordering is the assertion.
    */
    const gate = COHORT.indexOf('gateCohortInvite(');
    const creates = COHORT.indexOf("'/api/recipients'");
    // ⚠️ Both bounds asserted first. indexOf returns -1 when absent, and -1 is
    // dutifully "less than" any real index — so without this the test passes
    // most convincingly when the gate has been deleted entirely.
    expect(gate, 'no gate call found at all').toBeGreaterThan(-1);
    expect(creates, 'no person-creation call found — this test has gone blind').toBeGreaterThan(-1);
    expect(gate, 'the readiness gate runs after people are created').toBeLessThan(creates);
  });

  it('exits non-zero when it refuses', () => {
    const gate = COHORT.indexOf('gateCohortInvite(');
    const after = COHORT.slice(gate, gate + 400);
    expect(after).toContain('process.exit(1)');
  });
});
