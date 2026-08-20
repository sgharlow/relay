/**
 * The owner front door's attempt budget.
 *
 * Every test here was written to fail first against the unbudgeted door — the
 * state this repo shipped in until 2026-08-20 — and the two that matter most
 * are not the ones that prove the door closes. They are the ones that prove it
 * OPENS: an authentication control whose own behaviour locks out every owner is
 * a worse outcome than the gap it closes, and this codebase already carries the
 * rule that a guard nobody can satisfy is a lockout.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkSigninAllowed,
  recordSigninFailure,
  clearSigninFailures,
  failuresFor,
  throttleKey,
  MAX_FAILED_ATTEMPTS,
  FAILURE_WINDOW_MS,
  MAX_SOURCE_ATTEMPTS,
  _resetSigninThrottleForTesting,
} from './signin-throttle';
import { _resetRateLimitForTesting } from '../http/rate-limit';

const EMAIL = 'owner@example.org';
const IP = '203.0.113.7';

/** Burn n failures against one address, as `authorize` would. */
function fail(email: string, n: number, now: number): void {
  for (let i = 0; i < n; i += 1) recordSigninFailure(email, now);
}

beforeEach(() => {
  _resetSigninThrottleForTesting();
  _resetRateLimitForTesting();
});

describe('the address budget', () => {
  it('lets an ordinary person in — nothing is refused on a clean slate', () => {
    expect(checkSigninAllowed(EMAIL, IP, 1_000).allowed).toBe(true);
  });

  it('still lets them in one attempt short of the budget', () => {
    fail(EMAIL, MAX_FAILED_ATTEMPTS - 1, 1_000);
    expect(checkSigninAllowed(EMAIL, IP, 1_000).allowed).toBe(true);
  });

  it('closes the door at the budget, and says which counter did it', () => {
    fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    const gate = checkSigninAllowed(EMAIL, IP, 1_000);
    expect(gate.allowed).toBe(false);
    expect(gate.refusedBy).toBe('address');
  });

  it('opens again once the window passes — a budget, not a ban', () => {
    fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    expect(checkSigninAllowed(EMAIL, IP, 1_000).allowed).toBe(false);
    expect(checkSigninAllowed(EMAIL, IP, 1_000 + FAILURE_WINDOW_MS + 1).allowed).toBe(true);
  });

  it('is per address — one owner burning their budget does not touch another', () => {
    fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    expect(checkSigninAllowed(EMAIL, IP, 1_000).allowed).toBe(false);
    expect(checkSigninAllowed('other@example.org', IP, 1_000).allowed).toBe(true);
  });
});

describe('a success clears it — this is a failure budget, not a rate limit', () => {
  it('forgets the failures that came before a correct code', () => {
    fail(EMAIL, MAX_FAILED_ATTEMPTS - 1, 1_000);
    expect(failuresFor(EMAIL, 1_000)).toBe(MAX_FAILED_ATTEMPTS - 1);

    clearSigninFailures(EMAIL);

    expect(failuresFor(EMAIL, 1_000)).toBe(0);
    expect(checkSigninAllowed(EMAIL, IP, 1_000).allowed).toBe(true);
  });

  it('gives the fumbling owner the whole budget back, not a top-up', () => {
    fail(EMAIL, 9, 1_000);
    clearSigninFailures(EMAIL);
    fail(EMAIL, MAX_FAILED_ATTEMPTS - 1, 1_000);
    expect(checkSigninAllowed(EMAIL, IP, 1_000).allowed).toBe(true);
  });
});

describe('case and whitespace cannot mint a fresh budget', () => {
  it('normalises the key, so a shift key is not a bypass', () => {
    fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    expect(checkSigninAllowed('  Owner@Example.ORG ', IP, 1_000).allowed).toBe(false);
  });

  it('exports the same normalisation the caller must use', () => {
    expect(throttleKey('  Owner@Example.ORG ')).toBe(EMAIL);
  });

  it('clears under any casing', () => {
    fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    clearSigninFailures('OWNER@EXAMPLE.ORG');
    expect(checkSigninAllowed(EMAIL, IP, 1_000).allowed).toBe(true);
  });
});

describe('the source limit — the half the address budget cannot see', () => {
  it('bounds a spray across many addresses from one host', () => {
    // Each address is fresh, so the address budget never fires; only the
    // source counter can notice. This is the attack the per-account budget
    // is structurally blind to.
    let refused = 0;
    for (let i = 0; i < MAX_SOURCE_ATTEMPTS + 5; i += 1) {
      const gate = checkSigninAllowed(`spray-${i}@example.org`, IP, 1_000);
      if (!gate.allowed) {
        expect(gate.refusedBy).toBe('source');
        refused += 1;
      }
    }
    expect(refused).toBeGreaterThan(0);
  });

  it('is generous enough that a household does not trip it', () => {
    // Four people behind one NAT, each signing in twice in a window.
    for (let person = 0; person < 4; person += 1) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(checkSigninAllowed(`p${person}@example.org`, IP, 1_000).allowed).toBe(true);
      }
    }
  });

  it('does not exempt a caller it cannot identify', () => {
    let refused = false;
    for (let i = 0; i < MAX_SOURCE_ATTEMPTS + 5; i += 1) {
      if (!checkSigninAllowed(`u${i}@example.org`, null, 1_000).allowed) refused = true;
    }
    expect(refused).toBe(true);
  });

  it('keeps two sources apart', () => {
    for (let i = 0; i < MAX_SOURCE_ATTEMPTS + 5; i += 1) {
      checkSigninAllowed(`u${i}@example.org`, IP, 1_000);
    }
    expect(checkSigninAllowed('fresh@example.org', '198.51.100.4', 1_000).allowed).toBe(true);
  });
});

describe('what the caller may learn', () => {
  it('never explains itself to the outside — refusedBy is for the log only', () => {
    // The property under test is a discipline about the CALLER, so what this
    // asserts is the shape of the answer: a boolean plus a private reason.
    // lib/ops/signin-is-throttled.test.ts asserts the caller honours it.
    fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    const gate = checkSigninAllowed(EMAIL, IP, 1_000);
    expect(Object.keys(gate).sort()).toEqual(['allowed', 'refusedBy']);
    expect(typeof gate.allowed).toBe('boolean');
  });
});

describe('it cannot take the door down', () => {
  it('never throws, whatever it is handed', () => {
    expect(() => checkSigninAllowed('', null, 1_000)).not.toThrow();
    expect(() => recordSigninFailure('', 1_000)).not.toThrow();
    expect(() => clearSigninFailures('')).not.toThrow();
    expect(() => checkSigninAllowed('not-an-email', 'nonsense', 1_000)).not.toThrow();
  });

  it('bounds its own memory under a spray of distinct addresses', () => {
    // 12k distinct addresses against a 10k cap. The point is that it survives
    // and keeps answering, not the exact eviction order.
    for (let i = 0; i < 12_000; i += 1) recordSigninFailure(`flood-${i}@example.org`, 1_000);
    expect(checkSigninAllowed('someone@example.org', IP, 1_000).allowed).toBe(true);
  });
});
