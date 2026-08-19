/**
 * The sweep's judgement, and the two ways it could be quietly wrong.
 *
 * The dangerous failures here are not crashes. They are (a) an account that is
 * unsafe to delete being counted as safe, and (b) a reserved domain this repo
 * will happily CREATE that the sweep cannot RECOGNISE — a blind spot exactly the
 * shape of the bug it was written for.
 *
 * Feature: relay-h0-mvp
 * Requirements: D4 (the countable half)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  RESERVED_TLDS,
  isDisposableAddress,
  judge,
  staleCount,
  formatSweepReport,
  type DisposableRow,
} from './disposable-accounts';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function row(over: Partial<DisposableRow> = {}): DisposableRow {
  return {
    id: 'u1',
    email: 'relay-a11y-1@relay.test',
    created_at: hoursAgo(48),
    rows: {},
    has_subscription: false,
    standby_roles_elsewhere: 0,
    ...over,
  };
}

describe('recognising a throwaway address', () => {
  it('accepts every reserved TLD', () => {
    for (const tld of RESERVED_TLDS) {
      expect(isDisposableAddress(`someone@relay.${tld}`), `${tld} not recognised`).toBe(true);
    }
  });

  it('rejects a real address, whatever it looks like', () => {
    for (const real of ['a@relay.com', 'b@gmail.com', 'c@relay.test.com', 'd@testing.io']) {
      expect(isDisposableAddress(real), `${real} was treated as disposable`).toBe(false);
    }
  });

  /**
   * 🔴 THE BLIND SPOT THIS EXISTS TO PREVENT. `scripts/disposable-owner.ts` and
   * `scripts/capture-screens.ts` each carry their own RESERVED list, deciding
   * what they may CREATE. This module decides what may be RECOGNISED afterwards.
   * If a script gains a domain this list lacks, it can create accounts the sweep
   * will never report — and the sweep would go on saying zero, which is worse
   * than not having it.
   *
   * A guard rather than a refactor: those scripts are standalone and must keep
   * running without importing this module.
   */
  it('every script that CREATES a throwaway account uses the same reserved list', () => {
    const canonical = [...RESERVED_TLDS].sort().join(',');

    for (const script of ['scripts/disposable-owner.ts', 'scripts/capture-screens.ts']) {
      const src = readFileSync(script, 'utf8');
      const decl = /const RESERVED = \[([^\]]*)\]/.exec(src);

      expect(decl, `${script} no longer declares a RESERVED list — this guard has gone blind`).not.toBeNull();

      const theirs = decl![1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
        .sort()
        .join(',');

      expect(
        theirs,
        `${script} may create accounts on domains this sweep cannot see (or vice versa). ` +
          'Bring the two lists back into agreement — a domain one side knows and the other ' +
          'does not is an account nothing counts.',
      ).toBe(canonical);
    }
  });
});

describe('judging what was left behind', () => {
  it('an old account with nothing special is stale', () => {
    const [j] = judge([row({ created_at: hoursAgo(48) })], NOW);
    expect(j.disposition).toBe('stale');
    expect(j.age_hours).toBeCloseTo(48, 5);
  });

  it('a young account is recent, because a walk may still be running', () => {
    const [j] = judge([row({ created_at: hoursAgo(2) })], NOW);
    expect(j.disposition).toBe('recent');
  });

  it('the boundary is exclusive — exactly 24h old is not yet stale', () => {
    expect(judge([row({ created_at: hoursAgo(24) })], NOW)[0].disposition).toBe('recent');
    expect(judge([row({ created_at: hoursAgo(24.1) })], NOW)[0].disposition).toBe('stale');
  });

  /**
   * The recorded trap: a disposable-looking account holding live billing. It is
   * old, it looks abandoned, and deleting it would destroy the only pointer to
   * the Stripe object that is charging somebody.
   */
  it('a subscription holds the account, however old it is', () => {
    const [j] = judge([row({ created_at: hoursAgo(999), has_subscription: true })], NOW);
    expect(j.disposition).toBe('hold');
    expect(j.holds.join(' ')).toMatch(/subscriptions row/);
  });

  it('standing by in another owner\'s roster holds the account', () => {
    const [j] = judge([row({ created_at: hoursAgo(999), standby_roles_elsewhere: 2 })], NOW);
    expect(j.disposition).toBe('hold');
    expect(j.holds.join(' ')).toMatch(/2 other owner's rosters/);
  });

  /**
   * The invariant that matters most: the report must never be able to suggest
   * deleting something it has just called dangerous.
   */
  it('a held account is never also counted stale', () => {
    const judged = judge(
      [
        row({ id: 'a', created_at: hoursAgo(999), has_subscription: true }),
        row({ id: 'b', created_at: hoursAgo(999), standby_roles_elsewhere: 1 }),
        row({ id: 'c', created_at: hoursAgo(999) }),
      ],
      NOW,
    );
    expect(staleCount(judged)).toBe(1);
    expect(judged.filter((j) => j.disposition === 'hold')).toHaveLength(2);
  });

  it('a custom threshold moves the line', () => {
    expect(staleCount(judge([row({ created_at: hoursAgo(48) })], NOW, 72))).toBe(0);
    expect(staleCount(judge([row({ created_at: hoursAgo(48) })], NOW, 12))).toBe(1);
  });
});

describe('the report says what it found, including nothing', () => {
  it('an empty cluster is stated, not left as blank output', () => {
    const out = formatSweepReport([], NOW);
    expect(out).toMatch(/Nothing was left behind/);
    expect(out).toMatch(/Scanned 0 reserved-domain accounts/);
  });

  it('a clean-but-populated cluster says so rather than printing nothing', () => {
    const out = formatSweepReport(judge([row({ created_at: hoursAgo(1) })], NOW), NOW);
    expect(out).toMatch(/Nothing stale/);
  });

  it('a stale account is named, with its rows and the safe way to close it', () => {
    const out = formatSweepReport(
      judge([row({ created_at: hoursAgo(30), rows: { vault_items: 2, verifiers: 1 } })], NOW),
      NOW,
    );
    expect(out).toMatch(/STALE/);
    expect(out).toMatch(/vault_items=2/);
    expect(out).toMatch(/verifiers=1/);
    expect(out, 'the report must point at the cascade, not invite a hand-written DELETE').toMatch(/deleteAccount/);
    expect(out).toMatch(/never a hand-written DELETE/);
  });

  it('a held account is reported under HOLD with its reason, never under STALE', () => {
    const out = formatSweepReport(
      judge([row({ created_at: hoursAgo(999), has_subscription: true })], NOW),
      NOW,
    );
    expect(out).toMatch(/HELD/);
    expect(out).toMatch(/check Stripe/);
    expect(out).not.toMatch(/STALE/);
  });
});
