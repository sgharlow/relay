/**
 * The owner front door's attempt budget — both layers, and how they compose.
 *
 * Every test here was written to fail first against the unbudgeted door — the
 * state this repo shipped in until 2026-08-20 — and the ones that matter most
 * are not the ones that prove the door closes. They are the ones that prove it
 * OPENS: an authentication control whose own behaviour locks out every owner is
 * a worse outcome than the gap it closes, and this codebase already carries the
 * rule that a guard nobody can satisfy is a lockout.
 *
 * THE DURABLE STORE IS MOCKED HERE ON PURPOSE. This file is about the RULES —
 * what counts, what resets, what a null means. `signin-attempts.test.ts` covers
 * the store's own behaviour against a mocked `pg` boundary. Mocking it here also
 * means these tests never depend on a database being absent in a particular way,
 * which is how a suite quietly starts asserting its own environment.
 *
 * Feature: relay-h0-mvp
 * Requirements: 17.1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
  Controllable durable layer. `durableCount` is what the store would report:
  a number, or `null` for "cannot answer" — the distinction the composition
  turns on.
*/
let durableCount: number | null = null;
const recordedDurable: string[] = [];
const clearedDurable: string[] = [];

vi.mock('./signin-attempts', () => ({
  durableFailureCount: vi.fn(async () => durableCount),
  recordDurableFailure: vi.fn(async (email: string) => {
    recordedDurable.push(email);
  }),
  clearDurableFailures: vi.fn(async (email: string) => {
    clearedDurable.push(email);
  }),
}));

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
async function fail(email: string, n: number, now: number): Promise<void> {
  for (let i = 0; i < n; i += 1) await recordSigninFailure(email, now);
}

beforeEach(() => {
  _resetSigninThrottleForTesting();
  _resetRateLimitForTesting();
  durableCount = null;
  recordedDurable.length = 0;
  clearedDurable.length = 0;
});

describe('the address budget', () => {
  it('lets an ordinary person in — nothing is refused on a clean slate', async () => {
    expect((await checkSigninAllowed(EMAIL, IP, 1_000)).allowed).toBe(true);
  });

  it('still lets them in one attempt short of the budget', async () => {
    await fail(EMAIL, MAX_FAILED_ATTEMPTS - 1, 1_000);
    expect((await checkSigninAllowed(EMAIL, IP, 1_000)).allowed).toBe(true);
  });

  it('closes the door at the budget, and says which counter did it', async () => {
    await fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    const gate = await checkSigninAllowed(EMAIL, IP, 1_000);
    expect(gate.allowed).toBe(false);
    expect(gate.refusedBy).toBe('address');
  });

  it('opens again once the window passes — a budget, not a ban', async () => {
    await fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    expect((await checkSigninAllowed(EMAIL, IP, 1_000)).allowed).toBe(false);
    expect(
      (await checkSigninAllowed(EMAIL, IP, 1_000 + FAILURE_WINDOW_MS + 1)).allowed,
    ).toBe(true);
  });

  it('is per address — one owner burning their budget does not touch another', async () => {
    await fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    expect((await checkSigninAllowed(EMAIL, IP, 1_000)).allowed).toBe(false);
    expect((await checkSigninAllowed('other@example.org', IP, 1_000)).allowed).toBe(true);
  });
});

describe('a success clears it — this is a failure budget, not a rate limit', () => {
  it('forgets the failures that came before a correct code', async () => {
    await fail(EMAIL, MAX_FAILED_ATTEMPTS - 1, 1_000);
    expect(failuresFor(EMAIL, 1_000)).toBe(MAX_FAILED_ATTEMPTS - 1);

    await clearSigninFailures(EMAIL);

    expect(failuresFor(EMAIL, 1_000)).toBe(0);
    expect((await checkSigninAllowed(EMAIL, IP, 1_000)).allowed).toBe(true);
  });

  it('gives the fumbling owner the whole budget back, not a top-up', async () => {
    await fail(EMAIL, 9, 1_000);
    await clearSigninFailures(EMAIL);
    await fail(EMAIL, MAX_FAILED_ATTEMPTS - 1, 1_000);
    expect((await checkSigninAllowed(EMAIL, IP, 1_000)).allowed).toBe(true);
  });

  it('clears the durable side as well, or the reset would be a lie', async () => {
    // The whole point of a reset is that the NEXT instance sees it too. A clear
    // that only emptied process memory would leave the row standing and refuse
    // the same person from a different instance a second later.
    await clearSigninFailures(EMAIL);
    expect(clearedDurable).toEqual([EMAIL]);
  });
});

describe('case and whitespace cannot mint a fresh budget', () => {
  it('normalises the key, so a shift key is not a bypass', async () => {
    await fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    expect((await checkSigninAllowed('  Owner@Example.ORG ', IP, 1_000)).allowed).toBe(false);
  });

  it('exports the same normalisation the caller must use', () => {
    expect(throttleKey('  Owner@Example.ORG ')).toBe(EMAIL);
  });

  it('clears under any casing', async () => {
    await fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    await clearSigninFailures('OWNER@EXAMPLE.ORG');
    expect((await checkSigninAllowed(EMAIL, IP, 1_000)).allowed).toBe(true);
  });
});

describe('the source limit — the half the address budget cannot see', () => {
  it('bounds a spray across many addresses from one host', async () => {
    // Each address is fresh, so the address budget never fires; only the
    // source counter can notice. This is the attack the per-account budget
    // is structurally blind to.
    let refused = 0;
    for (let i = 0; i < MAX_SOURCE_ATTEMPTS + 5; i += 1) {
      const gate = await checkSigninAllowed(`spray-${i}@example.org`, IP, 1_000);
      if (!gate.allowed) {
        expect(gate.refusedBy).toBe('source');
        refused += 1;
      }
    }
    expect(refused).toBeGreaterThan(0);
  });

  it('is generous enough that a household does not trip it', async () => {
    // Four people behind one NAT, each signing in twice in a window.
    for (let person = 0; person < 4; person += 1) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect((await checkSigninAllowed(`p${person}@example.org`, IP, 1_000)).allowed).toBe(true);
      }
    }
  });

  it('does not exempt a caller it cannot identify', async () => {
    let refused = false;
    for (let i = 0; i < MAX_SOURCE_ATTEMPTS + 5; i += 1) {
      if (!(await checkSigninAllowed(`u${i}@example.org`, null, 1_000)).allowed) refused = true;
    }
    expect(refused).toBe(true);
  });

  it('keeps two sources apart', async () => {
    for (let i = 0; i < MAX_SOURCE_ATTEMPTS + 5; i += 1) {
      await checkSigninAllowed(`u${i}@example.org`, IP, 1_000);
    }
    expect((await checkSigninAllowed('fresh@example.org', '198.51.100.4', 1_000)).allowed).toBe(
      true,
    );
  });
});

describe('the durable layer — the half process memory cannot see', () => {
  it('refuses on a durable count even when THIS instance has seen nothing', async () => {
    // The defect the row exists for: serverless means many instances, so an
    // attacker spread across them is under-counted by every one of them.
    durableCount = MAX_FAILED_ATTEMPTS;
    const gate = await checkSigninAllowed(EMAIL, IP, 1_000);
    expect(gate.allowed).toBe(false);
    expect(gate.refusedBy).toBe('address');
  });

  it('allows below the durable budget', async () => {
    durableCount = MAX_FAILED_ATTEMPTS - 1;
    expect((await checkSigninAllowed(EMAIL, IP, 1_000)).allowed).toBe(true);
  });

  it('records every failure durably as well as in memory', async () => {
    await fail(EMAIL, 3, 1_000);
    expect(recordedDurable).toEqual([EMAIL, EMAIL, EMAIL]);
    expect(failuresFor(EMAIL, 1_000)).toBe(3);
  });
});

describe('null is not zero — the property that keeps a DSQL blip from locking everyone out', () => {
  it('lets a clean address through when the store cannot answer', async () => {
    durableCount = null;
    expect((await checkSigninAllowed(EMAIL, IP, 1_000)).allowed).toBe(true);
  });

  it('still refuses on the memory floor when the store cannot answer', async () => {
    // The floor is the point: an unreachable database must not be able to
    // REMOVE a control either. Memory decides, and memory has seen enough.
    durableCount = null;
    await fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    expect((await checkSigninAllowed(EMAIL, IP, 1_000)).allowed).toBe(false);
  });
});

describe('the database is not asked when the answer is already known', () => {
  it('does not consult the durable store for an address memory already refused', async () => {
    const { durableFailureCount } = await import('./signin-attempts');
    await fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    vi.mocked(durableFailureCount).mockClear();

    await checkSigninAllowed(EMAIL, IP, 1_000);

    // A refused attempt must cost no query, or a spray becomes load on DSQL
    // by way of the control that is supposed to stop it.
    expect(durableFailureCount).not.toHaveBeenCalled();
  });

  it('does not consult it for a source already refused either', async () => {
    const { durableFailureCount } = await import('./signin-attempts');
    for (let i = 0; i < MAX_SOURCE_ATTEMPTS; i += 1) {
      await checkSigninAllowed(`u${i}@example.org`, IP, 1_000);
    }
    vi.mocked(durableFailureCount).mockClear();

    const gate = await checkSigninAllowed('one-more@example.org', IP, 1_000);
    expect(gate.allowed).toBe(false);
    expect(durableFailureCount).not.toHaveBeenCalled();
  });
});

describe('what the caller may learn', () => {
  it('never explains itself to the outside — refusedBy is for the log only', async () => {
    // The property under test is a discipline about the CALLER, so what this
    // asserts is the shape of the answer: a boolean plus a private reason.
    // lib/ops/signin-is-throttled.test.ts asserts the caller honours it.
    await fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    const gate = await checkSigninAllowed(EMAIL, IP, 1_000);
    expect(Object.keys(gate).sort()).toEqual(['allowed', 'refusedBy']);
    expect(typeof gate.allowed).toBe('boolean');
  });

  it('refuses identically whether memory or the row decided', async () => {
    // An attacker must not be able to tell which layer stopped them, because
    // that difference would reveal whether other instances had seen them.
    await fail(EMAIL, MAX_FAILED_ATTEMPTS, 1_000);
    const fromMemory = await checkSigninAllowed(EMAIL, IP, 1_000);

    _resetSigninThrottleForTesting();
    durableCount = MAX_FAILED_ATTEMPTS;
    const fromRow = await checkSigninAllowed(EMAIL, IP, 1_000);

    expect(fromRow).toEqual(fromMemory);
  });
});

describe('it cannot take the door down', () => {
  it('never rejects, whatever it is handed', async () => {
    await expect(checkSigninAllowed('', null, 1_000)).resolves.toBeTruthy();
    await expect(recordSigninFailure('', 1_000)).resolves.toBeUndefined();
    await expect(clearSigninFailures('')).resolves.toBeUndefined();
    await expect(checkSigninAllowed('not-an-email', 'nonsense', 1_000)).resolves.toBeTruthy();
  });

  it('bounds its own memory under a spray of distinct addresses', async () => {
    // 12k distinct addresses against a 10k cap. The point is that it survives
    // and keeps answering, not the exact eviction order.
    for (let i = 0; i < 12_000; i += 1) await recordSigninFailure(`flood-${i}@example.org`, 1_000);
    expect((await checkSigninAllowed('someone@example.org', IP, 1_000)).allowed).toBe(true);
  });
});
