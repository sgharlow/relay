/**
 * Tests for access requests and owner-challenge-first.
 *
 * The naive design escalates every request straight to N-of-M. But a false
 * alarm burns the verification network's credibility for nothing, and an owner
 * who is conscious can simply say yes — asking three other people to vote on
 * something the owner is sitting right there agreeing to is absurd. Only the
 * owner-truly-unreachable case should consume verifier attention (J6-R2).
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R2, J6-R4, J6-R6, J6-R7, J6-R8
 */

import { describe, it, expect } from 'vitest';
import {
  sanitiseRequestReason,
  MAX_REASON_CHARS,
  CHALLENGE_WINDOW_SECONDS,
  MAX_REQUESTS_PER_WINDOW,
  VELOCITY_WINDOW_SECONDS,
  REFUSAL_COOLING_OFF_SECONDS,
  assertRequestAllowed,
  refusalCoolingOffUntil,
  challengeExpiry,
} from './access-request';
import { ValidationError } from '../validation';

describe('CHALLENGE_WINDOW_SECONDS', () => {
  it('covers every trigger type', () => {
    for (const t of ['emergency', 'travel', 'caregiver', 'business', 'estate'] as const) {
      expect(CHALLENGE_WINDOW_SECONDS[t]).toBeGreaterThan(0);
    }
  });

  it('gives emergency the shortest window — someone is waiting', () => {
    const others = (['travel', 'caregiver', 'business', 'estate'] as const).map(
      (t) => CHALLENGE_WINDOW_SECONDS[t],
    );
    for (const w of others) expect(w).toBeGreaterThanOrEqual(CHALLENGE_WINDOW_SECONDS.emergency);
  });

  it('gives ESTATE the longest — it cannot be undone', () => {
    const all = Object.values(CHALLENGE_WINDOW_SECONDS);
    expect(CHALLENGE_WINDOW_SECONDS.estate).toBe(Math.max(...all));
  });
});

describe('challengeExpiry', () => {
  it('is the request time plus that trigger type window', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    const exp = new Date(challengeExpiry('emergency', now));

    expect(exp.getTime() - now.getTime()).toBe(CHALLENGE_WINDOW_SECONDS.emergency * 1000);
  });

  it('falls back to the emergency window for an unknown type', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    const exp = new Date(challengeExpiry('nonsense' as never, now));

    expect(exp.getTime() - now.getTime()).toBe(CHALLENGE_WINDOW_SECONDS.emergency * 1000);
  });
});

describe('assertRequestAllowed', () => {
  const now = new Date('2026-08-06T12:00:00Z');

  it('allows a first request', () => {
    expect(() => assertRequestAllowed([], now)).not.toThrow();
  });

  /*
    `status: 'awaiting_owner'` throughout, so these keep testing the VELOCITY
    rule alone. Requests that were refused are the cooling-off rule's business
    and are exercised below; a fixture that quietly satisfied both would stop
    telling you which one fired.
  */
  it('allows requests below the velocity limit', () => {
    expect(() =>
      assertRequestAllowed([{ created_at: '2026-08-06T11:00:00Z', status: 'awaiting_owner' }], now),
    ).not.toThrow();
  });

  it('REJECTS once the velocity limit is reached', () => {
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({
      created_at: '2026-08-06T11:00:00Z',
      status: 'awaiting_owner',
    }));
    expect(() => assertRequestAllowed(recent, now)).toThrow(ValidationError);
  });

  it('ignores requests outside the window', () => {
    const old = new Date(now.getTime() - (VELOCITY_WINDOW_SECONDS + 60) * 1000).toISOString();
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({
      created_at: old,
      status: 'awaiting_owner',
    }));
    expect(() => assertRequestAllowed(recent, now)).not.toThrow();
  });

  it('counts only requests strictly inside the window boundary', () => {
    const exactly = new Date(now.getTime() - VELOCITY_WINDOW_SECONDS * 1000).toISOString();
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({
      created_at: exactly,
      status: 'awaiting_owner',
    }));
    // On the boundary still counts — the limit is deliberately conservative.
    expect(() => assertRequestAllowed(recent, now)).toThrow(ValidationError);
  });
});

/**
 * 🔴 Reason sanitisation — added by the 2026-08-12 security review.
 *
 * The reason was stored and mailed verbatim, which was inert while the endpoint
 * required a token nobody could obtain before a release. Giving J6 a front door
 * turned it into attacker-controlled text that Relay sends from its own domain
 * to the owner's inbox, and the attacker is the contact this architecture
 * already names as a threat: somebody named, who accepted, then turned hostile.
 *
 * Requirements: J6-R8
 */
describe('sanitiseRequestReason', () => {
  it('collapses newlines so the quoted block cannot be forged', () => {
    // The reason sits inside `They said: "..."` in a plain-text body. Newlines
    // let a sender close that quote visually and append text reading as Relay's.
    const forged = 'Mum fell.\n\n"\n\nRelay: confirm your identity at once.';
    const out = sanitiseRequestReason(forged) as string;
    expect(out).not.toMatch(/\n/);
    expect(out).toBe('Mum fell. " Relay: confirm your identity at once.');
  });

  it.each([
    'go to https://evil.example/login now',
    'see http://evil.example',
    'visit www.evil.example/login',
    'try HTTPS://EVIL.EXAMPLE',
  ])('removes links: %s', (raw) => {
    const out = sanitiseRequestReason(raw) as string;
    expect(out).toContain('[link removed]');
    expect(out.toLowerCase()).not.toContain('evil.example');
  });

  it('does not mangle ordinary prose', () => {
    const raw = "She fell at St. Mary's and I need the utility account.";
    expect(sanitiseRequestReason(raw)).toBe(raw);
  });

  it('caps the length so one request cannot carry a payload', () => {
    const out = sanitiseRequestReason('x'.repeat(50_000)) as string;
    expect(out).toHaveLength(MAX_REASON_CHARS);
  });

  /*
    🔴 THE COST OF SANITISING WAS QUADRATIC, and this is the test that found it —
    by TIMING OUT ON CI while passing on a faster laptop. The URL pattern's
    scheme part was unbounded, so a run of letters with no "://" after it made
    the engine consume the whole run at every start position: 2,000 chars 3ms,
    40,000 chars 1,199ms. `POST /api/access-requests` caps no body size, so a
    standby contact — the actor this sanitiser exists to defend against — could
    post a megabyte and hold a function's CPU until it timed out.

    The assertion is a WALL-CLOCK BUDGET rather than an exact figure, because the
    thing that must never come back is the SHAPE. Quadratic blows through a
    second here; linear finishes in single-digit milliseconds with room to spare
    on the slowest runner we use.
  */
  it('costs the same per character however long the input is', () => {
    const started = Date.now();
    sanitiseRequestReason('x'.repeat(1_000_000));
    const elapsed = Date.now() - started;
    expect(
      elapsed,
      `Sanitising 1,000,000 characters took ${elapsed}ms. That is the quadratic ` +
        'backtracking in URLISH coming back — check the scheme quantifier is bounded.',
    ).toBeLessThan(1_000);
  });

  it('still strips the schemes anybody actually uses', () => {
    expect(sanitiseRequestReason('see http://evil.com/x now')).toBe('see [link removed] now');
    expect(sanitiseRequestReason('at https://evil.com now')).toBe('at [link removed] now');
    expect(sanitiseRequestReason('go to www.evil.com please')).toBe('go to [link removed] please');
  });

  it('treats blank and non-string input as no reason', () => {
    expect(sanitiseRequestReason('   \n\t ')).toBeNull();
    expect(sanitiseRequestReason(undefined)).toBeNull();
    expect(sanitiseRequestReason(42)).toBeNull();
  });
});

/**
 * 🔴 A REFUSAL BOUGHT THE OWNER NOTHING — J6-R8, closed 2026-08-21.
 *
 * `assertRequestAllowed` was the only thing standing between a hostile contact
 * and a stream of asks, and it counts requests without ever looking at how they
 * ENDED. So an owner who read "someone is asking for access to your vault",
 * answered no, and put the phone down could be asked again a minute later, and
 * once more after that, before the 3-per-24h budget ran out. Three refusals in
 * an afternoon is not a rate limit doing its job — it is the wearing-down this
 * file's own header says the velocity limit exists to prevent, performed inside
 * the budget.
 *
 * The tests below pin both halves: the refusal must actually bar the next ask,
 * and it must stop barring it, because a cooling-off that never lifts is a
 * caregiver locked out of a real emergency.
 */
describe('cooling-off after a refusal (J6-R8)', () => {
  const now = new Date('2026-08-21T12:00:00Z');
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

  it('REFUSES the next ask inside the cooling-off period', () => {
    const recent = [{ created_at: ago(60), status: 'denied_by_owner' }];
    expect(() => assertRequestAllowed(recent, now)).toThrow(ValidationError);
  });

  it('names cooling_off, not velocity — the owner said no, they did not ask too fast', () => {
    // The two refusals read identically to a requester unless the field says
    // which rule fired, and they mean opposite things: "wait your turn" versus
    // "they answered you".
    const recent = [{ created_at: ago(60), status: 'denied_by_owner' }];
    try {
      assertRequestAllowed(recent, now);
      expect.unreachable('a refused request one minute ago must bar the next ask');
    } catch (err) {
      expect((err as ValidationError).field).toBe('cooling_off');
    }
  });

  it('LIFTS once the period has passed — a real emergency must not be locked out', () => {
    const recent = [
      { created_at: ago(REFUSAL_COOLING_OFF_SECONDS + 60), status: 'denied_by_owner' },
    ];
    expect(() => assertRequestAllowed(recent, now)).not.toThrow();
  });

  it('still bars on the exact boundary, like the velocity window above it', () => {
    const recent = [{ created_at: ago(REFUSAL_COOLING_OFF_SECONDS), status: 'denied_by_owner' }];
    expect(() => assertRequestAllowed(recent, now)).toThrow(ValidationError);
  });

  it('does not fire on a request the owner has not answered yet', () => {
    // An open request is the velocity limit's business. Treating "waiting" as
    // "refused" would silently double the wait on the commonest case.
    const recent = [{ created_at: ago(60), status: 'awaiting_owner' }];
    expect(() => assertRequestAllowed(recent, now)).not.toThrow();
  });

  it('does not fire on an APPROVED request', () => {
    const recent = [{ created_at: ago(60), status: 'approved_by_owner' }];
    expect(() => assertRequestAllowed(recent, now)).not.toThrow();
  });

  it('does not fire on an ESCALATED request — a lapse is not a refusal', () => {
    /*
      escalation.ts is explicit that "absence must never be read as consent";
      the mirror of that rule is that absence must never be read as REFUSAL
      either. An owner who was too ill to answer has not said no, and the
      recipient who asked is the person most likely to need to ask again.
    */
    const recent = [{ created_at: ago(60), status: 'escalated' }];
    expect(() => assertRequestAllowed(recent, now)).not.toThrow();
  });

  it('takes the MOST RECENT refusal, not the first one it finds', () => {
    // Rows arrive in whatever order the database returns them; a rule that
    // stopped at the first refused row would let an old one shadow a fresh one.
    const recent = [
      { created_at: ago(REFUSAL_COOLING_OFF_SECONDS * 3), status: 'denied_by_owner' },
      { created_at: ago(60), status: 'denied_by_owner' },
    ];
    expect(() => assertRequestAllowed(recent, now)).toThrow(ValidationError);
  });

  it('ignores an unparseable created_at rather than barring forever', () => {
    // Bad data must not become a permanent lock-out of the emergency path.
    const recent = [{ created_at: 'not a date', status: 'denied_by_owner' }];
    expect(() => assertRequestAllowed(recent, now)).not.toThrow();
  });

  it('is shorter than the velocity window, so it is a distinct rule and not a longer one', () => {
    /*
      The two limits answer different questions and the numbers have to reflect
      that. If the cooling-off were the longer of the two it would subsume the
      velocity limit, and one of them would be dead code nobody noticed.
    */
    expect(REFUSAL_COOLING_OFF_SECONDS).toBeLessThan(VELOCITY_WINDOW_SECONDS);
    expect(REFUSAL_COOLING_OFF_SECONDS).toBeGreaterThan(0);
  });

  it('the velocity limit still fires when nothing was refused', () => {
    // Adding a rule must not quietly replace the one already there.
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({
      created_at: ago(3600),
      status: 'awaiting_owner',
    }));
    try {
      assertRequestAllowed(recent, now);
      expect.unreachable('the velocity limit must still refuse');
    } catch (err) {
      expect((err as ValidationError).field).toBe('velocity');
    }
  });
});

describe('refusalCoolingOffUntil', () => {
  const now = new Date('2026-08-21T12:00:00Z');

  it('is null when nothing was ever refused', () => {
    expect(refusalCoolingOffUntil([{ created_at: now.toISOString(), status: 'awaiting_owner' }]))
      .toBeNull();
  });

  it('is the refusal instant plus the cooling-off period', () => {
    const at = new Date('2026-08-21T06:00:00Z');
    expect(refusalCoolingOffUntil([{ created_at: at.toISOString(), status: 'denied_by_owner' }]))
      .toBe(at.getTime() + REFUSAL_COOLING_OFF_SECONDS * 1000);
  });

  it('is null for an empty history', () => {
    expect(refusalCoolingOffUntil([])).toBeNull();
  });
});
