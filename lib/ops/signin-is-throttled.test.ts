/**
 * The front door actually calls its budget — asserted on the door, not on the
 * budget.
 *
 * 🔴 WHY A SEPARATE GUARD AT ALL. This repository's most-repeated defect is a
 * control that exists in a helper while the caller does not use it: a
 * request-body cap shipped in `readJson` and was recorded as closed while
 * sixteen handlers still called `req.json()` directly. `lib/ops/body-limit.ts`,
 * `route-auth.ts` and `step-up-guard.ts` are all the sibling that asserts the
 * routes actually use the thing. `lib/auth/signin-throttle.test.ts` proves the
 * budget counts correctly; nothing in it would notice if `authorize` stopped
 * calling it, and a budget nobody calls is the same as no budget at all.
 *
 * Textual and conservative, like its siblings: it asserts what must be PRESENT
 * in the provider rather than hunting for what must be absent, because a guard
 * that greps for a forbidden string matches the comment explaining the string.
 * Comments are stripped before matching for exactly that reason — this file is
 * about what the code does, and this codebase's comments discuss these calls at
 * length directly above them.
 *
 * Proven to fail: each assertion below was checked by deleting the call it
 * names from `lib/auth/auth-options.ts` and watching this file go red.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './api-reachability';

const AUTH_OPTIONS = join(process.cwd(), 'lib/auth/auth-options.ts');

/** The `email-totp` provider's body, comments removed. */
function emailTotpProvider(): string {
  const source = stripComments(readFileSync(AUTH_OPTIONS, 'utf8'));

  const start = source.indexOf("id: 'email-totp'");
  expect(start, 'the email-totp provider must still exist and be named').toBeGreaterThan(-1);

  // Ends where the next provider begins. The claim provider is the one that
  // follows it; if that ordering ever changes this returns too much rather
  // than too little, which fails safe for a presence check.
  const next = source.indexOf("id: 'standby-claim'", start);
  return source.slice(start, next > -1 ? next : source.length);
}

describe('the owner sign-in path is budgeted', () => {
  it('checks the budget before it does anything else', () => {
    expect(emailTotpProvider()).toContain('checkSigninAllowed(');
  });

  it('checks it BEFORE the database lookup, so a refused attempt costs no query', () => {
    const body = emailTotpProvider();
    const gate = body.indexOf('checkSigninAllowed(');
    const lookup = body.indexOf('resolveTotpSecret(');

    expect(gate).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(-1);
    expect(
      gate,
      'an unbudgeted door is an amplifier against DSQL as well as a way in',
    ).toBeLessThan(lookup);
  });

  it('spends the budget when a code is refused', () => {
    expect(emailTotpProvider()).toContain('recordSigninFailure(');
  });

  it('clears the budget when a code is accepted', () => {
    expect(emailTotpProvider()).toContain('clearSigninFailures(');
  });

  it('does NOT spend the budget on a lookup failure, which is ours and not theirs', () => {
    const body = emailTotpProvider();
    const catchBlock = body.slice(
      body.indexOf('resolveTotpSecret('),
      body.indexOf('validateTotpCodeFor('),
    );
    expect(
      catchBlock.includes('recordSigninFailure('),
      'charging a caller for our database being unreachable turns a DSQL blip ' +
        'into a lockout of every owner who tried during it',
    ).toBe(false);
  });
});

describe('the alarm rings with the limiter', () => {
  it('records a miss on the guess watch when a code is refused', () => {
    expect(emailTotpProvider()).toContain("recordCodeMiss('totp')");
  });

  it('records the miss in the same branch that spends the budget', () => {
    const body = emailTotpProvider();
    const spend = body.indexOf('recordSigninFailure(');
    const miss = body.indexOf("recordCodeMiss('totp')");

    expect(spend).toBeGreaterThan(-1);
    expect(miss).toBeGreaterThan(-1);
    // Adjacent, in the same failure branch. A limiter without an alarm hides
    // the attack it deflects — the attacker slows down and nobody learns.
    expect(Math.abs(miss - spend)).toBeLessThan(120);
  });
});

describe('a refusal is indistinguishable from any other failure', () => {
  it('returns the bare null that every other failure returns', () => {
    const body = emailTotpProvider();
    const gate = body.indexOf('checkSigninAllowed(');
    const afterGate = body.slice(gate, gate + 400);

    expect(afterGate).toContain('return null');
  });

  it('never hands the refusal reason back to the caller', () => {
    const body = emailTotpProvider();

    // `refusedBy` may be logged. It must never be returned, thrown, or put in
    // a response: answering "too many attempts" confirms that an address holds
    // a Relay account, which is exactly what the uniform null protects.
    const returned = /return[^;]*refusedBy/.test(body);
    const thrown = /throw[^;]*refusedBy/.test(body);

    expect(returned).toBe(false);
    expect(thrown).toBe(false);
  });
});

/**
 * The durable half, added with migration 036 (S2-1).
 *
 * The in-memory budget is per-instance, so a distributed attempt against one
 * address is under-counted by every instance and none of them ever reaches ten.
 * `lib/auth/signin-attempts.ts` is the row that closes that. It is composed
 * inside `signin-throttle.ts` rather than called from `authorize`, deliberately:
 * one choke point, and callers that never learn where a count is kept.
 *
 * ⚠️ WHAT THESE ASSERT IS THE PROPERTY THAT KEEPS IT SAFE, not that it exists.
 * A durable control on the front door can fail in two directions, and only one
 * of them is survivable. Under-counting lets an attacker through; over-refusing
 * locks out every owner in the world the moment DSQL hiccups. Migration 029 is
 * the recorded precedent for the second — it threw when its table was absent and
 * took passkey sign-in down for four minutes.
 */
describe('the durable budget cannot lock the product out', () => {
  const throttle = () =>
    stripComments(readFileSync(join(process.cwd(), 'lib/auth/signin-throttle.ts'), 'utf8'));
  const store = () =>
    stripComments(readFileSync(join(process.cwd(), 'lib/auth/signin-attempts.ts'), 'utf8'));

  it('the throttle consults the durable count', () => {
    expect(throttle()).toContain('durableFailureCount(');
  });

  it('and records and clears durably, or memory and the row disagree', () => {
    expect(throttle()).toContain('recordDurableFailure(');
    expect(throttle()).toContain('clearDurableFailures(');
  });

  it('refuses only on a NUMBER, never on the absence of an answer', () => {
    // `null` means the store could not answer. Treating it as a refusal hands
    // any DSQL blip the power to lock out every owner at once.
    const src = throttle();
    expect(src).toMatch(/durable\s*!==\s*null\s*&&\s*durable\s*>=/);
  });

  it('asks the database only after memory has already allowed the attempt', () => {
    const src = throttle();
    const sourceGate = src.indexOf('MAX_SOURCE_ATTEMPTS');
    const durable = src.indexOf('await durableFailureCount(');
    expect(sourceGate).toBeGreaterThan(-1);
    expect(durable).toBeGreaterThan(-1);
    // A refused attempt must cost no query, or the control that stops a spray
    // becomes the thing that turns it into database load.
    expect(durable).toBeGreaterThan(sourceGate);
  });

  it('the store never throws — every entry point catches', () => {
    const src = store();
    for (const fn of [
      'durableFailureCount',
      'recordDurableFailure',
      'clearDurableFailures',
      'sweepOldSigninAttempts',
    ]) {
      const at = src.indexOf(`export async function ${fn}`);
      expect(at, `${fn} is gone`).toBeGreaterThan(-1);
      const body = src.slice(at, at + 900);
      expect(body, `${fn} does not catch`).toContain('catch');
    }
  });

  it('the address is hashed before it reaches a query', () => {
    const src = store();
    // The table records failures against addresses that have no account — it
    // must, or throttling would tell an attacker which addresses are real. In
    // plaintext that makes it a list of everyone anybody ever tried.
    expect(src).toContain('createHash');
    for (const call of ['INSERT INTO signin_attempts', 'DELETE FROM signin_attempts']) {
      expect(src).toContain(call);
    }
    expect(src.match(/signinKeyFor\(email\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('the migration exists and uses the shapes DSQL actually supports', () => {
    const sql = readFileSync(join(process.cwd(), 'db/migrations/036_signin_attempts.sql'), 'utf8');
    /*
      🔴 STRIPPED FIRST, AND THIS TEST CAUGHT ITSELF DOING THE WRONG THING.
      The first draft asserted `not.toContain('ON CONFLICT')` against the whole
      file and went red — on the migration's own COMMENT, which explains at
      length why ON CONFLICT is not used here. That is the failure CLAUDE.md
      names in its own words: "a guard that greps for a forbidden string matches
      the comment that explains the string." An absence check must look only at
      what executes.
    */
    const statements = sql.replace(/--[^\n]*/g, ' ');

    expect(statements).toContain('CREATE TABLE IF NOT EXISTS signin_attempts');
    // DSQL supports no other index kind, and no sort order on key columns.
    expect(statements).toContain('CREATE INDEX ASYNC');
    // ON CONFLICT errored on real infra and 500'd the first live claim.
    expect(statements).not.toContain('ON CONFLICT');
    // A counter column would be a write-write conflict under snapshot isolation.
    expect(statements).not.toContain('UPDATE');
  });
});
