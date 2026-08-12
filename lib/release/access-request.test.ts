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
  assertRequestAllowed,
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

  it('allows requests below the velocity limit', () => {
    expect(() => assertRequestAllowed([{ created_at: '2026-08-06T11:00:00Z' }], now)).not.toThrow();
  });

  it('REJECTS once the velocity limit is reached', () => {
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({
      created_at: '2026-08-06T11:00:00Z',
    }));
    expect(() => assertRequestAllowed(recent, now)).toThrow(ValidationError);
  });

  it('ignores requests outside the window', () => {
    const old = new Date(now.getTime() - (VELOCITY_WINDOW_SECONDS + 60) * 1000).toISOString();
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({ created_at: old }));
    expect(() => assertRequestAllowed(recent, now)).not.toThrow();
  });

  it('counts only requests strictly inside the window boundary', () => {
    const exactly = new Date(now.getTime() - VELOCITY_WINDOW_SECONDS * 1000).toISOString();
    const recent = Array.from({ length: MAX_REQUESTS_PER_WINDOW }, () => ({ created_at: exactly }));
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

  it('treats blank and non-string input as no reason', () => {
    expect(sanitiseRequestReason('   \n\t ')).toBeNull();
    expect(sanitiseRequestReason(undefined)).toBeNull();
    expect(sanitiseRequestReason(42)).toBeNull();
  });
});
