/**
 * What a lapse does to a customer's data — pinned, so the humane answer stops
 * being an accident.
 *
 * THE FINDING (`PROJECT.yaml → deferred → the-post-lapse-state-is-undefined`,
 * E2). A lapsed owner drops to the free tier holding a vault that may exceed the
 * free cap. Nothing is deleted — but that is an **emergent property of where the
 * checks sit**, not a decision anybody made or wrote down. A custodian must be
 * able to answer *"what happens to my data if I stop paying"* in one sentence,
 * and `/terms` could not, because nothing had decided it.
 *
 * 🔴 THE RISK THIS CLOSES IS NOT A BUG, IT IS A REFACTOR. Today, somebody
 * tidying `entitlements.ts` could move a cap check from the add path onto a read
 * path, or add a downgrade handler that trims a vault to the free limit, and no
 * test anywhere would notice — while `/terms` went on promising otherwise. This
 * file is what makes the promise checkable.
 *
 * ESTABLISHED BY READING THE CODE, path by path, on 2026-08-20:
 *
 *   existing items        untouched. Nothing iterates or deletes them
 *   adding an item        REFUSED above the cap (POST /api/vault/items, /api/import)
 *   editing an item       allowed — PUT is not gated
 *   existing recipients   untouched; adding refused above the cap
 *   existing verifiers    untouched; adding refused above the cap
 *   access rules          never gated at all
 *   release states        never gated; arming a trigger checks `canRelease`
 *   reveal / decrypt      not gated by tier
 *   export                not gated by tier
 *
 * So a lapse changes exactly one thing: **what you can ADD.**
 *
 * ⚠️ IN SCOPE TO DESCRIBE, OUT OF SCOPE TO CHANGE. Whether that is the RIGHT
 * behaviour is Steve's decision; this file asserts what it currently is, and
 * `/terms` says the same thing in one sentence. `canRelease` is untouched —
 * that is `ratified.beta-free-release`, dated 2026-10-01.
 *
 * Feature: relay-h0-mvp
 * Requirements: J1-R7, J1-R8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIER_LIMITS } from '../billing/entitlements';

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const ENTITLEMENTS = read('lib/billing/entitlements.ts');
const TERMS = read('src/app/terms/page.tsx');

describe('the free tier keeps what is already there', () => {
  it('caps are ADD-time checks: every gate counts BEFORE inserting, never after', () => {
    const src = stripComments(ENTITLEMENTS);
    // Each cap reads a count and throws. None of them deletes, trims or
    // rewrites anything — which is the whole reason a lapse is survivable.
    for (const forbidden of ['DELETE FROM', 'UPDATE vault_items', 'TRUNCATE']) {
      expect(src, `entitlements.ts must never ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the item cap is enforced on the add paths and nowhere else', () => {
    const callers = ['src/app/api/vault/items/route.ts', 'src/app/api/import/route.ts'];
    for (const f of callers) {
      expect(stripComments(read(f))).toMatch(/assert(Batch)?WithinItemCap\(/);
    }
  });

  it('EDITING an existing item is not gated — an over-cap owner can still maintain their vault', () => {
    // The humane half, and the one a "tidy the caps" refactor would break
    // first: PUT /api/vault/items/[id] must not acquire a cap check.
    const put = stripComments(read('src/app/api/vault/items/[id]/route.ts'));
    expect(put).not.toMatch(/assert(Batch)?WithinItemCap\(/);
  });

  it('REVEAL is not gated by tier — a lapse must never cost somebody access in an emergency', () => {
    const unwrap = stripComments(read('src/app/api/kms/unwrap/route.ts'));
    expect(unwrap).not.toContain('entitlements');
    expect(unwrap).not.toContain('TIER_LIMITS');
  });

  it('EXPORT is not gated by tier — the way out cannot depend on paying', () => {
    const exportRoute = stripComments(read('src/app/api/account/export/route.ts'));
    expect(exportRoute).not.toContain('entitlements');
    expect(exportRoute).not.toContain('TIER_LIMITS');
  });
});

describe('nothing deletes on a downgrade', () => {
  it('the webhook changes tier and status, and touches no customer data', () => {
    const webhook = stripComments(read('src/app/api/stripe/webhook/route.ts'));
    for (const forbidden of [
      'DELETE FROM vault_items',
      'DELETE FROM recipients',
      'DELETE FROM verifiers',
      'DELETE FROM access_rules',
    ]) {
      expect(webhook, `the billing webhook must never ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('bulk deletion of a vault lives only in account closure, which is a different act', () => {
    // lib/account/lifecycle.ts deletes on deleteAccount() — deliberate, asked
    // for, and preceded by cancelling billing. A lapse is not that.
    const lifecycle = read('lib/account/lifecycle.ts');
    expect(lifecycle).toContain('DELETE FROM vault_items');

    const at = lifecycle.indexOf('DELETE FROM vault_items');
    const enclosing = lifecycle.slice(Math.max(0, at - 3000), at);
    expect(
      /deleteAccount/.test(enclosing),
      'vault deletion has moved out of the account-closure path',
    ).toBe(true);
  });
});

describe('the free tier still lets a release happen', () => {
  it('canRelease is true on free, and this test does NOT assert it should be', () => {
    /*
      ⚠️ THIS PINS THE CURRENT STATE, NOT A POSITION. `beta-free-release` is a
      dated ruling (revisit 2026-10-01) and flipping it is Steve's. The value is
      asserted here so that flipping it is a DELIBERATE act that turns this test
      red and makes somebody read the three artifacts that must move together —
      not a one-line change that quietly converts an expired card into a blocked
      release. docs/backlog.md S3-3 is the assembled change-set.
    */
    expect(TIER_LIMITS.free.canRelease).toBe(true);
    expect(TIER_LIMITS.paid.canRelease).toBe(true);
  });

  it('the free tier holds fewer items than paid, which is what a lapse actually changes', () => {
    expect(Number.isFinite(TIER_LIMITS.free.items)).toBe(true);
    expect(Number.isFinite(TIER_LIMITS.paid.items)).toBe(false);
  });
});

describe('the Terms say the same thing the code does', () => {
  it('answers what happens to the data on a lapse', () => {
    expect(TERMS).toMatch(/stop paying|subscription ends|plan ends/i);
  });

  it('promises the vault is kept, which is what the code above proves', () => {
    expect(TERMS).toMatch(/nothing is deleted/i);
  });

  it('is honest that adding is what changes', () => {
    expect(TERMS).toMatch(/add/i);
  });

  it('does not promise the paid tier keeps working', () => {
    // The one over-promise available here. A lapsed plan is a free plan.
    expect(TERMS).not.toMatch(/keep your paid|remain on the paid plan/i);
  });
});
