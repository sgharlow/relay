/**
 * Tests for the production canary's check definitions.
 *
 * WHY A CANARY AND NOT AN ERROR REPORTER. Next 14 has no global hook for route
 * errors, so anything in-app only covers the handlers someone remembered to
 * wrap — which is precisely the wrong shape for catching the failure nobody
 * anticipated. The verifier 500 found on 2026-08-08 was live for weeks behind a
 * fully green suite; what would have caught it is something exercising the real
 * path from outside, on a schedule.
 *
 * These checks assert BEHAVIOUR, not liveness. A 200 on a landing page proves
 * almost nothing; "a forged token is refused" proves the authorization boundary
 * is still standing.
 *
 * Feature: relay-h0-mvp (CC9)
 */

import { describe, it, expect } from 'vitest';

import { CHECKS, evaluateCheck, type CanaryCheck } from './canary';

const byName = (name: string): CanaryCheck => {
  const c = CHECKS.find((x) => x.name === name);
  if (!c) throw new Error(`no check named ${name}`);
  return c;
};

function res(status: number, body = ''): { status: number; body: string } {
  return { status, body };
}

describe('canary check evaluation', () => {
  it('passes a check whose status matches', () => {
    const check = byName('landing page serves');
    expect(evaluateCheck(check, res(200)).ok).toBe(true);
  });

  it('fails a check whose status does not match, and says what it saw', () => {
    const check = byName('landing page serves');
    const result = evaluateCheck(check, res(500));

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('500');
    expect(result.detail).toContain('200');
  });

  it('fails when the body is missing required content, even on a 200', () => {
    // The failure this models is a page that renders its shell and none of its
    // substance — status codes alone would call that healthy.
    const check = byName('signup page offers enrolment');
    expect(evaluateCheck(check, res(200, '<html>nothing useful</html>')).ok).toBe(false);
    expect(evaluateCheck(check, res(200, 'Create your vault ... authenticator')).ok).toBe(true);
  });
});

describe('what the canary actually covers', () => {
  it('refuses a forged verifier token — the authorization boundary', () => {
    const check = byName('forged verifier token refused');
    expect(check.expectStatus).toBe(403);
    // A 500 here is the exact regression fixed on 2026-08-08, so the check must
    // treat it as failure rather than "not a 403, close enough".
    expect(evaluateCheck(check, res(500)).ok).toBe(false);
    expect(evaluateCheck(check, res(403)).ok).toBe(true);
  });

  it('refuses an unauthenticated checkout — nobody starts a subscription anonymously', () => {
    const check = byName('checkout requires a session');
    expect(check.expectStatus).toBe(401);
    expect(evaluateCheck(check, res(200)).ok).toBe(false);
  });

  it('refuses a forged Stripe webhook — the whole paid-entitlement model', () => {
    const check = byName('forged stripe webhook refused');
    expect(check.expectStatus).toBe(400);
    // A 200 here would mean anyone can grant themselves a paid subscription.
    expect(evaluateCheck(check, res(200)).ok).toBe(false);
  });

  it('covers the paid-traffic entry point, not just the home page', () => {
    expect(CHECKS.some((c) => c.path.startsWith('/caregivers'))).toBe(true);
  });

  it('every check explains what its failure means, for whoever is woken up', () => {
    // A canary that fails with "check 4 failed" at 3am is a canary that gets
    // muted. Each one has to carry its own consequence.
    for (const check of CHECKS) {
      expect(check.meaning, `${check.name} has no meaning`).toBeTruthy();
      expect(check.meaning.length).toBeGreaterThan(20);
    }
  });

  it('never sends credentials or creates data', () => {
    for (const check of CHECKS) {
      const serialised = JSON.stringify(check);
      expect(serialised).not.toMatch(/secret|password|sk_live|whsec_/i);
      // POSTs are allowed only where they cannot persist anything: a refused
      // webhook and a refused checkout. A canary that signs accounts up would
      // be writing rows into production every fifteen minutes, forever.
      if (check.method === 'POST') {
        expect([400, 401]).toContain(check.expectStatus);
      }
    }
  });
});
